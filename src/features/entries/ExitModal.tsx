import { useState } from 'react';
import { X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { closeEntry } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import {
  localDb,
  type LocalEntry,
  type LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
import { printReceipt, type ReceiptData } from '../../lib/print/receipt';
import { PaymentMethodSelect } from './PaymentMethodSelect';
import {
  calcSuggestedAmount,
  computeChange,
  formatDuration,
  generateUuidV7,
  isCashMethod,
} from './entryUtils';

interface Props {
  entry: LocalEntry;
  tenantId: string;
  accessToken: string;
  onClose: () => void;
}

export function ExitModal({ entry, tenantId, accessToken, onClose }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();

  const now = new Date().toISOString();
  const hourPrice = entry.rateSnapshotHourPriceArs
    ? parseFloat(entry.rateSnapshotHourPriceArs)
    : 0;
  const stayPrice = entry.rateSnapshotStayPriceArs
    ? parseFloat(entry.rateSnapshotStayPriceArs)
    : 0;
  const fractionPrice = entry.rateSnapshotFractionPriceArs
    ? parseFloat(entry.rateSnapshotFractionPriceArs)
    : 0;

  const suggested = calcSuggestedAmount(
    entry.enteredAt,
    now,
    hourPrice,
    stayPrice,
    fractionPrice,
  );

  const [amount, setAmount] = useState(
    suggested > 0 ? suggested.toFixed(2) : '',
  );
  const [received, setReceived] = useState('');
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [selectedPmId, setSelectedPmId] = useState('');
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  const enabledPms = useLiveQuery(
    () =>
      localDb.paymentMethods
        .where('tenantId')
        .equals(tenantId)
        .filter((pm) => pm.enabled)
        .toArray(),
    [tenantId],
  );

  const activeSession = useLiveQuery(
    () =>
      localDb.cashSessions
        .where('tenantId')
        .equals(tenantId)
        .filter((s) => !s.closedAt)
        .first(),
    [tenantId],
  );

  // Pre-select default PM if none is selected yet
  const pms = enabledPms ?? [];
  const defaultPm = pms.find((pm) => pm.isDefault) ?? pms[0];
  const effectivePmId = selectedPmId || defaultPm?.id || '';
  const effectivePm = pms.find((pm) => pm.id === effectivePmId);

  const splitTotal = pms.reduce((sum, pm) => {
    const v = parseFloat(splitAmounts[pm.id]?.replace(',', '.') || '0');
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);

  const parsedAmount = parseFloat(amount.replace(',', '.'));
  const amountToCharge =
    Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
  const parsedReceived = parseFloat(received.replace(',', '.'));
  const receivedAmount =
    Number.isFinite(parsedReceived) && parsedReceived > 0 ? parsedReceived : 0;

  // Cash collection shows received + change only for the cash method on a
  // single-method payment; split or non-cash methods are charged exactly.
  const isCash =
    !splitEnabled && !!effectivePm && isCashMethod(effectivePm.name);
  const change = computeChange(amountToCharge, receivedAmount);
  const shortfall = Math.max(0, amountToCharge - receivedAmount);
  const receivedEntered = received.trim() !== '';

  // Result-block state for the cash flow (traffic-light UX):
  //   short  → received below the charge (alert, blocks confirm)
  //   over   → change to give back (success)
  //   exact  → exact amount or not entered yet (neutral)
  // EPSILON guards against float noise on 2-decimal amounts.
  const EPSILON = 0.005;
  const cashState =
    receivedEntered && shortfall > EPSILON
      ? 'short'
      : change > EPSILON
        ? 'over'
        : 'exact';

  // Received is optional (charges the exact amount); only an entered amount
  // below the charge blocks confirmation.
  const canConfirm = !isCash || cashState !== 'short';

  // Split mode: compare the entered total against the amount to charge so the
  // operator sees what's left to cover (advisory, does not block confirm).
  const splitRemaining = amountToCharge - splitTotal;
  const splitState =
    !splitEnabled || amountToCharge <= 0
      ? 'exact'
      : splitRemaining > EPSILON
        ? 'short'
        : splitRemaining < -EPSILON
          ? 'over'
          : 'exact';

  async function handleConfirm(): Promise<void> {
    setSaving(true);
    const leftAt = new Date().toISOString();
    const cashSessionId = entry.cashSessionId ?? activeSession?.id;

    let amountPaid: number | undefined;
    let payments:
      | Array<{
          id: string;
          paymentMethodId?: string;
          paymentMethodName: string;
          amount: number;
        }>
      | undefined;

    if (splitEnabled) {
      const lines = pms
        .map((pm) => {
          const v = parseFloat(splitAmounts[pm.id]?.replace(',', '.') || '0');
          return { pm, v: Number.isFinite(v) ? v : 0 };
        })
        .filter(({ v }) => v > 0)
        .map(({ pm, v }) => ({
          id: generateUuidV7(),
          paymentMethodId: pm.id,
          paymentMethodName: pm.name,
          amount: v,
        }));

      if (lines.length > 0) {
        payments = lines;
        amountPaid = lines.reduce((s, l) => s + l.amount, 0);
      }
    } else {
      const v = parseFloat(amount.replace(',', '.'));
      amountPaid = Number.isFinite(v) && v > 0 ? v : undefined;
      if (effectivePm && amountPaid !== undefined) {
        payments = [
          {
            id: generateUuidV7(),
            paymentMethodId: effectivePm.id,
            paymentMethodName: effectivePm.name,
            amount: amountPaid,
          },
        ];
      }
    }

    try {
      if (isOnline) {
        const result = await closeEntry({
          tenantId,
          entryId: entry.id,
          expectedVersion: entry.version,
          bearer: accessToken,
          body: { leftAt, amountPaid, cashSessionId, payments },
        });
        const txs: LocalPaymentTransaction[] = (payments ?? []).map((p) => ({
          id: p.id,
          tenantId,
          entryId: entry.id,
          cashSessionId,
          paymentMethodId: p.paymentMethodId,
          paymentMethodName: p.paymentMethodName,
          amount: p.amount,
          version: 1,
          syncSeq: 0,
          updatedAt: leftAt,
        }));
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.paymentTransactions,
          async () => {
            await localDb.entries.update(entry.id, {
              leftAt: result.leftAt ?? undefined,
              amountPaid:
                result.amountPaid !== null
                  ? String(result.amountPaid)
                  : undefined,
              version: result.version,
              syncSeq: result.syncSeq,
              updatedAt: result.updatedAt,
            });
            if (txs.length > 0) {
              await localDb.paymentTransactions.bulkPut(txs);
            }
          },
        );
      } else {
        const txs: LocalPaymentTransaction[] = (payments ?? []).map((p) => ({
          id: p.id,
          tenantId,
          entryId: entry.id,
          cashSessionId,
          paymentMethodId: p.paymentMethodId,
          paymentMethodName: p.paymentMethodName,
          amount: p.amount,
          version: 1,
          syncSeq: 0,
          updatedAt: leftAt,
        }));

        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.paymentTransactions,
          localDb.pendingOps,
          async () => {
            await localDb.entries.update(entry.id, {
              leftAt,
              amountPaid:
                amountPaid !== undefined ? String(amountPaid) : undefined,
              version: entry.version + 1,
              updatedAt: leftAt,
            });
            if (txs.length > 0) {
              await localDb.paymentTransactions.bulkPut(txs);
            }
            await enqueuePendingOp({
              entityType: 'entry',
              operation: 'update',
              tenantId,
              entityId: entry.id,
              payload: {
                expectedVersion: entry.version,
                body: { leftAt, amountPaid, cashSessionId, payments },
              },
              status: 'pending',
            });
          },
        );
      }

      showToast({
        message: isOnline
          ? `Egreso registrado: ${entry.plate}`
          : `Egreso guardado localmente: ${entry.plate}`,
        kind: 'success',
      });
      const effectiveReceivedAmount = receivedEntered
        ? receivedAmount
        : amountToCharge;
      const effectiveChange = computeChange(
        amountToCharge,
        effectiveReceivedAmount,
      );
      setReceipt({
        plate: entry.plate,
        ticketNumber: entry.ticketNumber ?? undefined,
        amountDue: amountPaid ?? 0,
        received: isCash ? effectiveReceivedAmount : undefined,
        change: isCash ? effectiveChange : undefined,
        paymentMethodName: splitEnabled
          ? 'Varios medios'
          : (effectivePm?.name ?? ''),
        leftAt,
      });
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rate-dialog-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="rate-dialog exit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-modal-title"
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">Egreso</p>
            <h3 id="exit-modal-title">{entry.plate}</h3>
            {entry.color ? <p className="muted">{entry.color}</p> : null}
            {entry.ticketNumber != null ? (
              <p className="muted">Ticket #{entry.ticketNumber}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="rate-dialog-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>

        {receipt ? (
          <div className="exit-receipt">
            <div className="exit-modal-info">
              <div className="exit-info-row">
                <span className="muted">Cobrado</span>
                <span className="exit-duration">
                  {formatArs(receipt.amountDue)}
                </span>
              </div>
              <div className="exit-info-row">
                <span className="muted">Medio</span>
                <span>{receipt.paymentMethodName}</span>
              </div>
              {receipt.received !== undefined ? (
                <>
                  <div className="exit-info-row">
                    <span className="muted">Recibido</span>
                    <span className="exit-received-amount">
                      {formatArs(receipt.received)}
                    </span>
                  </div>
                  <div className="exit-info-row">
                    <span className="muted">Vuelto</span>
                    <span className="exit-change-amount">
                      {formatArs(receipt.change ?? 0)}
                    </span>
                  </div>
                </>
              ) : null}
            </div>
            <div className="rate-dialog-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => printReceipt(receipt)}
              >
                Imprimir comprobante
              </button>
              <button
                type="button"
                className="primary-button compact"
                onClick={onClose}
              >
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (saving || !canConfirm) return;
              void handleConfirm();
            }}
          >
            <div className="exit-modal-info">
              <div className="exit-info-row">
                <span className="muted">Ingresó</span>
                <span>{formatArgentinaDateTime(entry.enteredAt)}</span>
              </div>
              <div className="exit-info-row">
                <span className="muted">Tiempo</span>
                <span className="exit-duration">
                  {formatDuration(entry.enteredAt)}
                </span>
              </div>
              {entry.rateSnapshotName ? (
                <>
                  <div className="exit-info-row">
                    <span className="muted">Tarifa</span>
                    <span>{entry.rateSnapshotName}</span>
                  </div>
                  <div className="exit-info-row exit-rate-breakdown">
                    <span className="muted">Precios</span>
                    <span className="exit-rate-breakdown-value">
                      Estadía {formatArs(stayPrice)} · Hora{' '}
                      {formatArs(hourPrice)} · Fracción{' '}
                      {formatArs(fractionPrice)}
                    </span>
                  </div>
                </>
              ) : null}
            </div>

            <div className="form-field exit-money-field">
              <label className="form-label" htmlFor="exit-amount">
                Monto a cobrar
              </label>
              <div className="exit-money-input">
                <span className="exit-money-prefix" aria-hidden="true">
                  $
                </span>
                <input
                  id="exit-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  className="exit-money-control"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
              </div>
              {suggested > 0 ? (
                <p className="form-helper">Sugerido: {formatArs(suggested)}</p>
              ) : null}
            </div>

            {pms.length > 1 ? (
              <label className="exit-split-toggle">
                <input
                  type="checkbox"
                  checked={splitEnabled}
                  onChange={(e) => setSplitEnabled(e.target.checked)}
                />
                <span>Dividir pago entre varios medios</span>
              </label>
            ) : null}

            {splitEnabled ? (
              <div className="exit-split">
                {pms.map((pm) => (
                  <div key={pm.id} className="exit-split-row">
                    <span className="exit-split-name">{pm.name}</span>
                    <div className="exit-money-input exit-money-input--compact">
                      <span className="exit-money-prefix" aria-hidden="true">
                        $
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        className="exit-money-control"
                        aria-label={`Monto en ${pm.name}`}
                        value={splitAmounts[pm.id] ?? ''}
                        onChange={(e) =>
                          setSplitAmounts((prev) => ({
                            ...prev,
                            [pm.id]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}

                <div
                  className="exit-split-summary"
                  role="status"
                  aria-live="polite"
                >
                  <div className="exit-split-summary-row">
                    <span className="muted">Total ingresado</span>
                    <span className="exit-split-total">
                      {formatArs(splitTotal)}
                    </span>
                  </div>
                  {amountToCharge > 0 ? (
                    <div
                      className={`exit-split-summary-row exit-split-status exit-split-status--${splitState}`}
                    >
                      <span>
                        {splitState === 'short'
                          ? 'Restante'
                          : splitState === 'over'
                            ? 'Excede'
                            : 'Cubre el monto'}
                      </span>
                      <span>{formatArs(Math.abs(splitRemaining))}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {pms.length > 0 ? (
                  <div className="form-field">
                    <span className="form-label">Medio de pago</span>
                    <PaymentMethodSelect
                      options={pms}
                      value={effectivePmId}
                      onChange={setSelectedPmId}
                      ariaLabel="Medio de pago"
                    />
                  </div>
                ) : null}

                {isCash ? (
                  <>
                    <div className="form-field exit-money-field">
                      <label className="form-label" htmlFor="exit-received">
                        Monto recibido
                      </label>
                      <div className="exit-money-input exit-money-input--received">
                        <span className="exit-money-prefix" aria-hidden="true">
                          $
                        </span>
                        <input
                          id="exit-received"
                          type="text"
                          inputMode="decimal"
                          placeholder="0,00"
                          className="exit-money-control"
                          value={received}
                          onChange={(e) => setReceived(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>

                    <div
                      className={`exit-result exit-result--${cashState}`}
                      role="status"
                      aria-live="polite"
                    >
                      <span className="exit-result-label">
                        {cashState === 'short' ? 'Faltan' : 'Vuelto'}
                      </span>
                      <span className="exit-result-amount">
                        {formatArs(cashState === 'short' ? shortfall : change)}
                      </span>
                    </div>
                  </>
                ) : null}
              </>
            )}

            <div className="rate-dialog-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={onClose}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="primary-button compact"
                disabled={saving || !canConfirm}
              >
                {saving ? 'Confirmando...' : 'Confirmar cobro'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
