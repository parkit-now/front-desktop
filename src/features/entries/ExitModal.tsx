import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { closeEntry } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import {
  localDb,
  type LocalEntry,
  type LocalPaymentTransaction,
  type PaymentMethodKind,
} from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
import { printReceipt, type ReceiptData } from '../../lib/print/receipt';
import { PaymentMethodSelect } from './PaymentMethodSelect';
import { MercadoPagoQrPanel } from './MercadoPagoQrPanel';
import { useMercadoPagoIntent } from './useMercadoPagoIntent';
import {
  calcSuggestedAmount,
  computeChange,
  formatDuration,
  generateUuidV7,
  isCashMethod,
  isMercadoPagoMethod,
  qrChargeBlockReason,
  QR_BLOCK_MESSAGES,
  type StayPrices,
} from './entryUtils';

/** Cada cuánto se recalcula el sugerido con el modal abierto. */
const TICK_MS = 15_000;

interface Props {
  entry: LocalEntry;
  tenantId: string;
  accessToken: string;
  onClose: () => void;
}

export function ExitModal({ entry, tenantId, accessToken, onClose }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();

  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const prices: StayPrices = useMemo(
    () => ({
      hour: parseFloat(entry.rateSnapshotHourPriceArs ?? '') || 0,
      fraction: parseFloat(entry.rateSnapshotFractionPriceArs ?? '') || 0,
      mediaEstadia:
        parseFloat(entry.rateSnapshotMediaEstadiaPriceArs ?? '') || 0,
      stay: parseFloat(entry.rateSnapshotStayPriceArs ?? '') || 0,
    }),
    [
      entry.rateSnapshotFractionPriceArs,
      entry.rateSnapshotHourPriceArs,
      entry.rateSnapshotMediaEstadiaPriceArs,
      entry.rateSnapshotStayPriceArs,
    ],
  );

  const suggested = useMemo(
    () =>
      calcSuggestedAmount(
        entry.enteredAt,
        new Date(nowMs).toISOString(),
        prices,
      ),
    [entry.enteredAt, nowMs, prices],
  );

  const [amount, setAmount] = useState(
    suggested > 0 ? suggested.toFixed(2) : '',
  );
  const [amountEdited, setAmountEdited] = useState(false);

  useEffect(() => {
    if (amountEdited) return;
    setAmount(suggested > 0 ? suggested.toFixed(2) : '');
  }, [amountEdited, suggested]);
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
    !splitEnabled &&
    !!effectivePm &&
    isCashMethod(effectivePm.type, effectivePm.name);
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

  // ── Cobro con QR de Mercado Pago ──────────────────────────────────────────
  // Sólo en cobro de un solo medio: repartir una estadía entre QR y efectivo
  // exigiría atar una línea del split a un intento, y hoy el backend crea UN
  // intento por estadía. Ver el reporte de la feature.
  const isMpQr = !splitEnabled && isMercadoPagoMethod(effectivePm);

  // Las dos precondiciones (hay red, y la estadía existe del lado del
  // servidor) viven en `entryUtils` para poder testearlas sin React.
  const qrBlockReason = qrChargeBlockReason({
    isOnline,
    entrySyncSeq: entry.syncSeq,
  });

  const mpIntent = useMercadoPagoIntent({
    tenantId,
    accessToken,
    entryId: entry.id,
    amount: amountToCharge,
  });

  // El error del POST sale por el mismo canal que el resto de la app: un toast
  // con el texto de `translateApiError`. Ahí es donde el 409 de caja ocupada
  // se convierte en "hay un cobro con QR en curso, esperá a que termine".
  const { errorMessage: mpErrorMessage } = mpIntent;
  useEffect(() => {
    if (!mpErrorMessage) return;
    showToast({ message: mpErrorMessage, kind: 'error' });
  }, [mpErrorMessage, showToast]);

  /**
   * Cortar en el CLICK y no en el submit, igual que el botón de cerrar caja.
   *
   * El medio se sigue viendo y se sigue pudiendo tocar: un ítem gris no
   * explica por qué no anda, y encima no es focusable ni lo anuncian los
   * lectores de pantalla (ver AGENTS.md). Lo que hacemos es no mover la
   * selección — el operario queda parado sobre un medio con el que SÍ puede
   * cobrar — y decirle en el toast qué pasó y qué hacer.
   */
  function handlePaymentMethodChange(id: string): void {
    const picked = pms.find((pm) => pm.id === id);
    if (isMercadoPagoMethod(picked) && qrBlockReason) {
      showToast({ message: QR_BLOCK_MESSAGES[qrBlockReason], kind: 'error' });
      return;
    }
    setSelectedPmId(id);
  }

  /**
   * El gate se vuelve a chequear ACÁ y no sólo al elegir el medio.
   *
   * El QR puede llegar preseleccionado sin que nadie lo haya tocado: si es el
   * medio predeterminado, o si es el único habilitado, `effectivePm` lo agarra
   * solo. Sin este chequeo, un equipo sin red entra al modal ya parado sobre
   * "Cobrar con QR" y el click sale igual, para morir en un error de red que
   * no explica nada.
   */
  function handleStartQr(): void {
    if (qrBlockReason) {
      showToast({ message: QR_BLOCK_MESSAGES[qrBlockReason], kind: 'error' });
      return;
    }
    void mpIntent.start();
  }

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

  /**
   * @param paymentIntentId Cobro con QR ya acreditado que hay que aplicar.
   *   Viaja DENTRO de la línea de pago (`payments[].paymentIntentId`), no al
   *   nivel raíz: es el contrato acordado con el cierre de estadía, porque lo
   *   que el intento respalda es UNA línea del cobro y no el egreso entero.
   */
  async function handleConfirm(paymentIntentId?: string): Promise<void> {
    setSaving(true);
    const leftAt = new Date().toISOString();
    const cashSessionId = entry.cashSessionId ?? activeSession?.id;

    let amountPaid: number | undefined;
    // El SNAPSHOT del medio de pago: id, nombre Y tipo. Los tres se copian
    // acá, al cobrar, y no se vuelven a tocar: el método puede renombrarse o
    // borrarse después, y ni el comprobante ni el arqueo pueden cambiar por
    // eso. El `type` es el que el cierre de caja usa para saber qué plata
    // quedó en el cajón.
    let payments:
      | Array<{
          id: string;
          paymentMethodId?: string;
          paymentMethodName: string;
          paymentMethodType?: PaymentMethodKind;
          amount: number;
          /**
           * Todavía NO está en `PaymentLineDto` del OpenAPI: el endpoint que
           * lo consume se está construyendo en paralelo y `sync-types` no
           * corrió (el backend no está levantado). Se manda igual porque el
           * contrato ya está acordado, y al regenerar los tipos esto tiene que
           * quedar cubierto por el DTO en vez de por esta declaración local.
           */
          paymentIntentId?: string;
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
          paymentMethodType: pm.type,
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
            paymentMethodType: effectivePm.type,
            amount: amountPaid,
            paymentIntentId,
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
          paymentMethodType: p.paymentMethodType,
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
          paymentMethodType: p.paymentMethodType,
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
        ) : mpIntent.intent && mpIntent.view ? (
          <MercadoPagoQrPanel
            // El monto es el CONGELADO en el intento, no el del input: si el
            // operario tocara el campo con el QR ya generado, mostrarle el
            // nuevo sería decirle que el cliente va a ver un importe que no es
            // el que Mercado Pago tiene cargado.
            amount={mpIntent.intent.amount}
            view={mpIntent.view}
            secondsLeft={mpIntent.secondsLeft}
            isCanceling={mpIntent.isCanceling}
            isConfirming={saving}
            onCancel={() => void mpIntent.cancel()}
            onRetry={handleStartQr}
            onUseAnotherMethod={mpIntent.reset}
            onConfirm={() => void handleConfirm(mpIntent.intent?.id)}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Con QR el cobro no se confirma acá: primero hay que generar la
              // orden y esperar a que el cliente pague. Sin este corte, un
              // Enter en el campo del monto cerraría la estadía como si ya
              // estuviera cobrada.
              if (isMpQr) return;
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
                      Hora {formatArs(prices.hour)} · Fracción{' '}
                      {formatArs(prices.fraction)}
                      {/* Una tarifa vieja no tiene escalón de 12h: mostrarlo en
                          $0 haría pensar que la media estadía es gratis. */}
                      {prices.mediaEstadia > 0
                        ? ` · Media estadía ${formatArs(prices.mediaEstadia)}`
                        : ''}{' '}
                      · Estadía {formatArs(prices.stay)}
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
                  onChange={(e) => {
                    setAmountEdited(true);
                    setAmount(e.target.value);
                  }}
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
                      onChange={handlePaymentMethodChange}
                      ariaLabel="Medio de pago"
                    />
                    {isMpQr ? (
                      <p className="form-helper">
                        El cliente escanea el QR del mostrador: el importe le
                        aparece solo.
                      </p>
                    ) : null}
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
              {isMpQr ? (
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={handleStartQr}
                  // Sin monto no hay orden que encolar: el backend exige un
                  // importe positivo y el cliente no tendría qué pagar.
                  disabled={mpIntent.isStarting || amountToCharge <= 0}
                >
                  {mpIntent.isStarting ? 'Generando QR...' : 'Cobrar con QR'}
                </button>
              ) : (
                <button
                  type="submit"
                  className="primary-button compact"
                  disabled={saving || !canConfirm}
                >
                  {saving ? 'Confirmando...' : 'Confirmar cobro'}
                </button>
              )}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
