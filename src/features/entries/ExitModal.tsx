import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { issueInvoice } from '../../lib/api/arca';
import {
  closeEntry,
  type InvoiceSummaryDto,
  type PaymentLineDto,
} from '../../lib/api/entries';
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
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { PaymentMethodSelect } from './PaymentMethodSelect';
import { MercadoPagoQrPanel } from './MercadoPagoQrPanel';
import { useMercadoPagoIntent } from './useMercadoPagoIntent';
import {
  canIssueAfterCharge,
  describeInvoiceResult,
  describeIssueConfirmation,
  expectedLetter,
  type InvoiceNotice,
} from './invoiceUtils';
import { InvoiceReceiverChooser } from './InvoiceReceiverChooser';
import { useArcaEmitter } from './useArcaEmitter';
import { useInvoiceReceiver } from './useInvoiceReceiver';
import {
  calcSuggestedAmount,
  computeChange,
  formatDuration,
  isCashCovered,
  generateUuidV7,
  isCashMethod,
  isMercadoPagoMethod,
  qrChargeBlockReason,
  QR_BLOCK_MESSAGES,
  type StayPrices,
} from './entryUtils';
import { sortByName } from '../payment-methods/paymentMethodUtils';

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
  const [invoiceNotice, setInvoiceNotice] = useState<InvoiceNotice | null>(
    null,
  );
  // El receptor: consumidor final o el CUIT que dicta el cliente (la letra la
  // decide el padrón). Lo mismo sirve para el cobro y para «Emitir factura».
  const emitter = useArcaEmitter(tenantId, accessToken, isOnline);
  // Certificado vencido: el cobro sigue igual, pero no se factura (la
  // factura queda pendiente hasta que el dueño lo renueve).
  const invoicingPaused = emitter?.certExpired ?? false;
  const offersReceiver = emitter !== null && !invoicingPaused;
  const receiver = useInvoiceReceiver({ tenantId, accessToken, isOnline });
  const letter = expectedLetter({
    emitter: emitter?.condicionIva,
    choice: receiver.choice,
    lookup: receiver.lookup,
  });
  const [lastInvoice, setLastInvoice] = useState<InvoiceSummaryDto | null>(
    null,
  );
  const [issuePanelOpen, setIssuePanelOpen] = useState(false);
  const [confirmIssueOpen, setConfirmIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const enabledPms = useLiveQuery(
    () =>
      localDb.paymentMethods
        .where('tenantId')
        .equals(tenantId)
        .filter((pm) => pm.enabled)
        .toArray()
        .then(sortByName),
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

  // El receptor se elige sólo si el cobro factura solo (todos los medios en
  // Automática): con un medio Manual se elige al emitir después.
  const selectedModes = splitEnabled
    ? pms
        .filter(
          (pm) => parseFloat(splitAmounts[pm.id]?.replace(',', '.') || '0') > 0,
        )
        .map((pm) => pm.invoiceMode)
    : effectivePm
      ? [effectivePm.invoiceMode]
      : [];
  const invoicesOnCharge =
    selectedModes.length > 0 && selectedModes.every((mode) => mode === 'auto');
  const showInvoiceChooser = offersReceiver && invoicesOnCharge;
  const showPausedNotice =
    invoicingPaused && selectedModes.some((mode) => mode !== 'none');

  // En efectivo hay que cargar lo que entregó el cliente, y tiene que cubrir
  // el total (justo o con vuelto). Con CUIT, hay que esperar al padrón.
  const cashCovered = isCashCovered(amountToCharge, receivedAmount);
  const canConfirm =
    (!isCash || cashCovered) && !(showInvoiceChooser && !receiver.ready);
  const invoiceReceiverCuit = showInvoiceChooser
    ? receiver.cuitToSend
    : undefined;

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
    //
    // `paymentIntentId` viaja acá adentro y lo TIPA el DTO generado: hasta que
    // corrió `sync-types` esto era una declaración local, y como `payments` es
    // una variable (no un object literal pasado inline) el excess-property
    // checking de TS no aplicaba — el campo se mandaba sin que nada lo
    // verificara. Ahora sí lo verifica el contrato.
    let payments: PaymentLineDto[] | undefined;

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

    const lineModes = (payments ?? []).map(
      (p) => pms.find((pm) => pm.id === p.paymentMethodId)?.invoiceMode,
    );

    try {
      if (isOnline) {
        const result = await closeEntry({
          tenantId,
          entryId: entry.id,
          expectedVersion: entry.version,
          bearer: accessToken,
          body: {
            leftAt,
            amountPaid,
            cashSessionId,
            payments,
            invoiceReceiverCuit,
          },
        });
        setLastInvoice(result.invoice ?? null);
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
        // La factura se emite en el mismo request del cierre; si ARCA falló,
        // el egreso igual quedó registrado y acá sólo se avisa.
        setInvoiceNotice(
          describeInvoiceResult({
            invoice: result.invoice,
            offline: false,
            lineModes,
          }),
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
                body: {
                  leftAt,
                  amountPaid,
                  cashSessionId,
                  payments,
                  invoiceReceiverCuit,
                },
              },
              status: 'pending',
            });
          },
        );
        setInvoiceNotice(
          describeInvoiceResult({
            invoice: undefined,
            offline: true,
            lineModes,
          }),
        );
      }

      showToast({
        message: isOnline
          ? `Egreso registrado: ${entry.plate}`
          : `Egreso guardado localmente: ${entry.plate}`,
        kind: 'success',
      });
      setReceipt({
        plate: entry.plate,
        ticketNumber: entry.ticketNumber ?? undefined,
        amountDue: amountPaid ?? 0,
        received: isCash ? receivedAmount : undefined,
        change: isCash ? change : undefined,
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

  /**
   * «Emitir factura» después del cobro: medio en Manual, o un intento que no
   * salió (por ejemplo, un CUIT que ARCA no tiene). La estadía tiene que
   * existir en el servidor, así que sólo con red.
   */
  async function handleIssue(): Promise<void> {
    if (!isOnline) {
      showToast({
        message: 'Necesitás conexión para emitir la factura.',
        kind: 'error',
      });
      return;
    }
    if (!receiver.ready) {
      receiver.markTouched();
      return;
    }
    setIssuing(true);
    try {
      const invoice = await issueInvoice({
        tenantId,
        entryId: entry.id,
        bearer: accessToken,
        receiverCuit: receiver.cuitToSend,
      });
      setLastInvoice(invoice);
      setInvoiceNotice(
        describeInvoiceResult({ invoice, offline: false, lineModes: [] }),
      );
      if (invoice.status === 'issued') setIssuePanelOpen(false);
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setIssuing(false);
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
            <div className="exit-modal-info exit-receipt-summary">
              <div className="exit-info-row">
                <span className="muted">Cobrado</span>
                <span className="exit-receipt-total">
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
                    <span>{formatArs(receipt.received)}</span>
                  </div>
                  <div className="exit-info-row">
                    <span className="muted">Vuelto</span>
                    <span className="exit-change-amount">
                      {formatArs(receipt.change ?? 0)}
                    </span>
                  </div>
                </>
              ) : null}
              {invoiceNotice ? (
                <div className="exit-info-row exit-info-row--invoice">
                  <span className="muted">Factura</span>
                  <span
                    className={`exit-invoice-notice exit-invoice-notice--${invoiceNotice.tone}`}
                    role={invoiceNotice.tone === 'warning' ? 'alert' : 'status'}
                  >
                    {invoiceNotice.text}
                    {invoiceNotice.detail ? (
                      <span className="exit-invoice-detail">
                        {invoiceNotice.detail}
                      </span>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </div>

            {issuePanelOpen ? (
              // El panel reemplaza a los botones del comprobante: mientras se
              // elige la factura, la única salida es emitir o volver.
              <div className="exit-issue-panel">
                <p className="exit-issue-title">Emitir factura</p>
                <InvoiceReceiverChooser
                  receiver={receiver}
                  emitter={emitter?.condicionIva}
                  isOnline={isOnline}
                  disabled={issuing}
                  showLabel={false}
                />
                <div className="rate-dialog-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setIssuePanelOpen(false)}
                    disabled={issuing}
                  >
                    Volver
                  </button>
                  <button
                    type="button"
                    className="primary-button compact"
                    onClick={() => setConfirmIssueOpen(true)}
                    disabled={issuing || !receiver.ready}
                  >
                    {letter ? `Emitir Factura ${letter}` : 'Emitir factura'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rate-dialog-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => printReceipt(receipt)}
                >
                  Imprimir comprobante
                </button>
                {!invoicingPaused && canIssueAfterCharge(lastInvoice) ? (
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={issuing}
                    onClick={() => setIssuePanelOpen(true)}
                  >
                    {issuing ? 'Emitiendo...' : 'Emitir factura'}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={onClose}
                >
                  Cerrar
                </button>
              </div>
            )}

            <ConfirmDialog
              open={confirmIssueOpen}
              {...describeIssueConfirmation({
                letter,
                cuit: receiver.cuitToSend,
                receiverName: receiver.receiverName,
                amount: formatArs(receipt.amountDue),
              })}
              isPending={issuing}
              onCancel={() => setConfirmIssueOpen(false)}
              onConfirm={async () => {
                await handleIssue();
                setConfirmIssueOpen(false);
              }}
            />
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

            {/* Fila 1: cuánto y con qué. El medio se oculta al dividir el
                pago, porque cada línea del split ya dice el suyo. */}
            <div className="exit-pay-grid">
              <div className="form-field">
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
                  <p className="exit-field-hint">
                    Sugerido: {formatArs(suggested)}
                  </p>
                ) : null}
              </div>

              {!splitEnabled && pms.length > 0 ? (
                <div className="form-field">
                  <span className="form-label">Medio de pago</span>
                  <PaymentMethodSelect
                    options={pms}
                    value={effectivePmId}
                    onChange={handlePaymentMethodChange}
                    ariaLabel="Medio de pago"
                  />
                  {isMpQr ? (
                    <p className="exit-field-hint">
                      El cliente escanea el QR del mostrador: el importe le
                      aparece solo.
                    </p>
                  ) : null}
                </div>
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
            ) : null}

            {/* Fila 2: la factura, debajo del medio porque depende de él. */}
            {showInvoiceChooser ? (
              <InvoiceReceiverChooser
                receiver={receiver}
                emitter={emitter?.condicionIva}
                isOnline={isOnline}
                disabled={saving}
              />
            ) : null}
            {showPausedNotice ? (
              <p className="exit-invoice-paused" role="status">
                Facturación pausada: el certificado de ARCA venció. Avisale al
                dueño.
              </p>
            ) : null}

            {/* Fila 3 (efectivo): lo que entregó el cliente y el vuelto, lado
                a lado y a la misma altura. */}
            {isCash ? (
              <div className="exit-pay-grid">
                <div className="form-field">
                  <label className="form-label" htmlFor="exit-received">
                    Recibido
                  </label>
                  <div className="exit-money-input">
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
                  {!receivedEntered && amountToCharge > 0 ? (
                    <p className="exit-field-hint">
                      Ingresá lo que te entregó el cliente.
                    </p>
                  ) : null}
                </div>
                <div className="form-field">
                  <span className="form-label">
                    {cashState === 'short' ? 'Faltan' : 'Vuelto'}
                  </span>
                  <div
                    className={`exit-change exit-change--${cashState}`}
                    role="status"
                    aria-live="polite"
                  >
                    {formatArs(cashState === 'short' ? shortfall : change)}
                  </div>
                </div>
              </div>
            ) : null}

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
