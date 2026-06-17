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
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
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

  // Cash payments require the received amount to cover the charge.
  const canConfirm = !isCash || receivedAmount >= amountToCharge;

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
            await localDb.pendingOps.add({
              entityType: 'entry',
              operation: 'update',
              tenantId,
              entityId: entry.id,
              payload: {
                expectedVersion: entry.version,
                body: { leftAt, amountPaid, cashSessionId, payments },
              },
              status: 'pending',
              createdAt: Date.now(),
              retryCount: 0,
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
      onClose();
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
            <div className="exit-info-row">
              <span className="muted">Tarifa</span>
              <span>{entry.rateSnapshotName}</span>
            </div>
          ) : null}
        </div>

        {!splitEnabled ? (
          <>
            {pms.length > 0 ? (
              <div className="form-field">
                <label className="form-label">Medio de pago</label>
                <select
                  value={effectivePmId}
                  onChange={(e) => setSelectedPmId(e.target.value)}
                  className="exit-pm-select"
                >
                  {pms.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div className="form-field">
              <label className="form-label">Monto a cobrar (ARS)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                className="exit-amount-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus
              />
              {suggested > 0 ? (
                <p className="form-helper">Sugerido: {formatArs(suggested)}</p>
              ) : null}
            </div>

            {isCash ? (
              <div className="form-field">
                <label className="form-label">Monto recibido (ARS)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                />
                <div className="exit-change-row">
                  <span className="muted">Vuelto</span>
                  <span className="exit-change-amount">
                    {formatArs(change)}
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="split-payment-grid">
            {pms.map((pm) => (
              <div key={pm.id} className="split-payment-row">
                <span className="split-pm-name">{pm.name}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={splitAmounts[pm.id] ?? ''}
                  onChange={(e) =>
                    setSplitAmounts((prev) => ({
                      ...prev,
                      [pm.id]: e.target.value,
                    }))
                  }
                />
              </div>
            ))}
            {pms.length > 0 && (
              <div className="split-total-row">
                <span>Total</span>
                <span className="split-total-amount">
                  {formatArs(splitTotal)}
                </span>
              </div>
            )}
          </div>
        )}

        {pms.length > 1 && (
          <label className="split-checkbox">
            <input
              type="checkbox"
              checked={splitEnabled}
              onChange={(e) => setSplitEnabled(e.target.checked)}
            />
            <span>Dividir pago entre varios medios</span>
          </label>
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
            type="button"
            className="primary-button compact"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={saving || !canConfirm}
          >
            {saving ? 'Confirmando...' : 'Confirmar cobro'}
          </button>
        </div>
      </section>
    </div>
  );
}
