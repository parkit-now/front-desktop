import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Bell, BellOff, FolderOpen, Save } from 'lucide-react';
import QRCode from 'qrcode';
import { getInvoiceDocument } from '../../lib/api/arca';
import { correctEntry, type CorrectEntryDto } from '../../lib/api/entries';
import { translateApiError, translateErrorCode } from '../../lib/api/translate';
import {
  localDb,
  type LocalEntry,
  type LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useToast } from '../../lib/notifications/ToastProvider';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { AppSelect } from '../../lib/ui/AppSelect';
import { Switch } from '../../lib/ui/Switch';
import { renderInvoiceHtml } from './invoiceDocument';
import { InvoiceReceiverChooser } from './InvoiceReceiverChooser';
import {
  eligibleInvoicePaymentIds,
  InvoicePaymentSelector,
} from './InvoicePaymentSelector';
import {
  describeIssueConfirmation,
  expectedLetter,
  formatExternalInvoice,
  formatIsoDay,
  INVOICE_STATE_BADGE,
  INVOICE_STATE_LABEL,
  invoicePdfFileName,
  isPartialInvoice,
  isUnbilled,
  isValidCuit,
  normalizeCuit,
  receiverDescription,
  resolveInvoiceState,
  voucherLabel,
} from './invoiceUtils';
import {
  type ArcaEmitter,
  toArcaEmitter,
  useArcaEmitterState,
} from './useArcaEmitter';
import {
  InvoiceAccountSelector,
  invoiceAccountLabel,
} from './InvoiceAccountSelector';
import { useInvoiceReceiver } from './useInvoiceReceiver';
import { useInvoiceConfirmation } from './useInvoiceConfirmation';
import { saveEntryInlineField } from './entryInlineFields';
import { ClientContact } from '../clients/ClientContact';
import { saveInvoicePdf } from './saveInvoicePdf';
import { refreshInvoiceHistory } from './invoiceHistory';

/**
 * Bloque «Factura» del diálogo de un movimiento del historial: el comprobante
 * y lo que se puede hacer según el estado. Emitir, reintentar y bajar el PDF
 * necesitan red (el PDF lo arma el desktop, pero con los datos que guardó el
 * backend al emitir); el checkbox «Facturada» de
 * las playas sin ARCA funciona offline, como cualquier corrección.
 *
 * Gemelo de `InvoiceDetail` del panel web.
 */
export function InvoiceSection({
  entry,
  paymentLines,
  paidTotal,
  tenantId,
  accessToken,
  isOnline,
  emitter: primaryEmitter,
  actorRole,
  invoiceModeAllowed,
}: {
  entry: LocalEntry;
  paymentLines: LocalPaymentTransaction[];
  paidTotal: number | null;
  tenantId: string;
  accessToken: string;
  isOnline: boolean;
  /** `null` = la playa no factura con ARCA. */
  emitter: ArcaEmitter | null;
  actorRole: 'admin' | 'owner' | 'operator' | null;
  invoiceModeAllowed: boolean;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<
    'pdf' | 'manual' | 'number' | 'folder' | 'external' | 'reminder' | null
  >(null);
  const [manualNumberDraft, setManualNumberDraft] = useState(
    entry.manualInvoiceNumber ?? '',
  );
  const [externalOpen, setExternalOpen] = useState(false);
  const [removeExternalOpen, setRemoveExternalOpen] = useState(false);
  const [externalType, setExternalType] = useState<'A' | 'B' | 'C'>(
    entry.manualInvoiceType ?? 'C',
  );
  const [externalPoint, setExternalPoint] = useState(
    entry.manualInvoicePointOfSale ?? '',
  );
  const [externalNumber, setExternalNumber] = useState(
    entry.manualInvoiceNumber ?? '',
  );
  const [externalOtherIssuer, setExternalOtherIssuer] = useState(
    !entry.manualInvoiceArcaAccountId &&
      Boolean(entry.manualInvoiceIssuerCuit || entry.manualInvoiceIssuerName),
  );
  const [externalIssuerCuit, setExternalIssuerCuit] = useState(
    entry.manualInvoiceIssuerCuit ?? '',
  );
  const [externalIssuerName, setExternalIssuerName] = useState(
    entry.manualInvoiceIssuerName ?? '',
  );
  const normalizedIssuerCuit = normalizeCuit(externalIssuerCuit);
  const externalIssuerValid =
    !externalOtherIssuer ||
    (Boolean(normalizedIssuerCuit || externalIssuerName.trim()) &&
      (!normalizedIssuerCuit || isValidCuit(normalizedIssuerCuit)));
  const [savedPdf, setSavedPdf] = useState<{
    invoiceId: string;
    path: string;
  } | null>(null);
  const confirmation = useInvoiceConfirmation({
    tenantId,
    entryId: entry.id,
    bearer: accessToken,
  });
  const actionBusy = busy !== null || confirmation.busy;
  // «Emitir factura» abre primero el receptor (consumidor final o CUIT).
  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[] | null>(
    null,
  );
  const invoice = useLiveQuery(
    () => localDb.invoices.where('entryId').equals(entry.id).first(),
    [entry.id],
  );
  const config = useArcaEmitterState(tenantId, accessToken, isOnline);
  const accounts = config.accounts ?? [];
  const [accountChoice, setAccountChoice] = useState<string>();
  const accountId =
    accountChoice ??
    invoice?.arcaAccountId ??
    accounts.find(
      (item) =>
        item.role === 'primary' &&
        ['linked', 'cert_expired'].includes(item.status),
    )?.id;
  const account = accounts.find((item) => item.id === accountId);
  const emitter = account
    ? toArcaEmitter(account)
    : accountId
      ? null
      : primaryEmitter;
  const emitterLocked = Boolean(
    invoice &&
    (invoice.status === 'issuing' ||
      invoice.status === 'issued' ||
      invoice.cbteNro != null),
  );
  const canSelectAccount = actorRole === 'owner' || actorRole === 'admin';
  const [externalAccountChoice, setExternalAccountChoice] = useState<string>();
  useEffect(() => {
    setAccountChoice(undefined);
    setExternalAccountChoice(undefined);
  }, [entry.id]);
  const externalAccountId =
    externalAccountChoice ??
    entry.manualInvoiceArcaAccountId ??
    accounts.find(
      (item) =>
        item.role === 'primary' &&
        ['linked', 'cert_expired'].includes(item.status),
    )?.id;
  const receiver = useInvoiceReceiver({
    tenantId,
    accessToken,
    isOnline,
    plate: entry.plate,
    entryId: entry.id,
    suggestionEnabled: issueOpen,
    frozen: actionBusy || confirmation.snapshot !== null,
    arcaAccountId: accountId,
  });
  const currentPaymentLines =
    useLiveQuery(
      () =>
        localDb.paymentTransactions
          .where('entryId')
          .equals(entry.id)
          .filter((line) => !line.deletedAt)
          .toArray(),
      [entry.id],
    ) ?? paymentLines;
  const paymentMethods = useLiveQuery(
    () => localDb.paymentMethods.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
  const invoicePaymentOptions = currentPaymentLines
    .filter((line) => line.amount > 0)
    .map((line) => ({
      id: line.id,
      name: line.paymentMethodName,
      amount: line.amount,
      disabled: paymentMethods
        ? !paymentMethods.some(
            (method) =>
              method.id === line.paymentMethodId &&
              method.invoiceMode !== 'none',
          )
        : false,
    }));
  const eligiblePaymentIds = eligibleInvoicePaymentIds(invoicePaymentOptions);
  const validPaymentIds = (
    selectedPaymentIds ??
    (invoice?.selectedPaymentIds?.length
      ? invoice.selectedPaymentIds
      : eligiblePaymentIds)
  ).filter((id) => eligiblePaymentIds.includes(id));
  const activePaymentIds =
    validPaymentIds.length > 0 ? validPaymentIds : eligiblePaymentIds;
  // Se lee de Dexie y no del prop: el prop es la fila de cuando se abrió el
  // diálogo, y el checkbox la cambia.
  const liveEntry = useLiveQuery(
    () => localDb.entries.get(entry.id),
    [entry.id],
  );
  const current = liveEntry ?? entry;

  useEffect(() => {
    setManualNumberDraft(current.manualInvoiceNumber ?? '');
    setExternalType(current.manualInvoiceType ?? 'C');
    setExternalPoint(current.manualInvoicePointOfSale ?? '');
    setExternalNumber(current.manualInvoiceNumber ?? '');
  }, [
    entry.id,
    current.manualInvoiceNumber,
    current.manualInvoiceType,
    current.manualInvoicePointOfSale,
  ]);

  const state = resolveInvoiceState(
    {
      leftAt: current.leftAt,
      paidTotal,
      manuallyInvoiced: current.manuallyInvoiced,
      invoiceStatusOverride: current.invoiceStatusOverride,
    },
    invoice,
  );
  if (state === 'na' && !invoice) return null;

  const hasVoucher = state === 'issued' || state === 'issuing';
  const partialInvoice = isPartialInvoice(state, invoice?.impTotal, paidTotal);
  const voucher = invoice ? voucherLabel(invoice) : null;
  const errorText =
    invoice && (state === 'error' || state === 'pending')
      ? (translateErrorCode(invoice.errorCode) ??
        (state === 'error' ? 'No se pudo emitir.' : null))
      : null;
  const showExternal =
    primaryEmitter !== null &&
    actorRole === 'owner' &&
    (state === 'none' ||
      state === 'pending' ||
      state === 'error' ||
      state === 'manual');
  const externalSaved = state === 'manual' && current.manuallyInvoiced;
  const canIssue =
    emitter !== null &&
    (account?.role !== 'secondary' || canSelectAccount) &&
    invoiceModeAllowed &&
    eligiblePaymentIds.length > 0 &&
    isUnbilled(state) &&
    !current.manuallyInvoiced &&
    !externalOpen;
  const showManual =
    primaryEmitter === null &&
    !accountId &&
    (state === 'none' || state === 'manual');
  const showReminder =
    actorRole === 'owner' &&
    (state === 'pending' || state === 'none') &&
    Boolean(current.leftAt) &&
    paidTotal !== null &&
    paidTotal > 0;
  const letter = expectedLetter({
    emitter: emitter?.condicionIva,
    choice: receiver.choice,
    lookup: receiver.lookup,
  });

  async function issue() {
    await confirmation.confirm((result) => {
      if (result.status === 'issued') setIssueOpen(false);
      showToast(
        result.status === 'issued'
          ? {
              message: `${voucherLabel(result) ?? 'La factura'} emitida.`,
              kind: 'success',
            }
          : {
              message:
                translateErrorCode(result.errorCode) ??
                'La factura no se pudo emitir.',
              kind: 'error',
            },
      );
    });
  }

  async function downloadPdf() {
    if (!invoice) return;
    setBusy('pdf');
    try {
      const doc = await getInvoiceDocument({
        tenantId,
        invoiceId: invoice.id,
        bearer: accessToken,
      });
      // Los datos llegaron: si algo falla de acá en adelante es de este equipo
      // (Chromium, disco), no del backend.
      try {
        const qr = await QRCode.toDataURL(doc.qrUrl, {
          width: 200,
          margin: 0,
          errorCorrectionLevel: 'M',
        });
        const saved = await saveInvoicePdf(
          invoicePdfFileName({ plate: current.plate, ...invoice }),
          renderInvoiceHtml(doc, qr),
        );
        if (saved) {
          setSavedPdf({ invoiceId: invoice.id, path: saved });
          showToast({ message: 'PDF guardado.', kind: 'success' });
        }
      } catch {
        showToast({
          message: 'No se pudo generar el PDF. Probá de nuevo.',
          kind: 'error',
        });
      }
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function showPdfInFolder() {
    const desktop = window.parkitDesktop;
    if (
      !savedPdf ||
      savedPdf.invoiceId !== invoice?.id ||
      !desktop?.showSavedFileInFolder
    )
      return;
    setBusy('folder');
    try {
      const result = await desktop.showSavedFileInFolder(savedPdf.path);
      if (!result.ok) throw new Error('show-file-failed');
    } catch {
      showToast({
        message: 'No se pudo encontrar o abrir el PDF guardado.',
        kind: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function toggleManual(next: boolean) {
    setBusy('manual');
    const body = { manuallyInvoiced: next };
    try {
      if (isOnline) {
        const result = await correctEntry({
          tenantId,
          entryId: entry.id,
          expectedVersion: current.version,
          bearer: accessToken,
          body,
        });
        await localDb.entries.update(entry.id, {
          manuallyInvoiced: result.manuallyInvoiced,
          manualInvoiceNumber: result.manualInvoiceNumber ?? undefined,
          version: result.version,
          syncSeq: result.syncSeq,
          updatedAt: result.updatedAt,
        });
      } else {
        const expectedVersion = current.version;
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.pendingOps,
          async () => {
            await localDb.entries.update(entry.id, {
              manuallyInvoiced: next,
              manualInvoiceNumber: next
                ? current.manualInvoiceNumber
                : undefined,
              version: expectedVersion + 1,
              updatedAt: new Date().toISOString(),
            });
            await enqueuePendingOp({
              entityType: 'entry',
              operation: 'update',
              tenantId,
              entityId: entry.id,
              payload: {
                kind: 'correction',
                expectedVersion,
                body,
              },
              status: 'pending',
            });
          },
        );
      }
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function setInvoicePending(next: boolean) {
    if (actionBusy || !showReminder || next === (state === 'pending')) return;
    setBusy('reminder');
    const expectedVersion = current.version;
    const override = next ? 'pending' : 'none';
    try {
      if (isOnline) {
        const result = await correctEntry({
          tenantId,
          entryId: entry.id,
          expectedVersion,
          bearer: accessToken,
          body: { invoicePending: next },
        });
        await localDb.entries.update(entry.id, {
          invoiceStatusOverride: override,
          version: result.version,
          syncSeq: result.syncSeq,
          updatedAt: result.updatedAt,
        });
        if (await refreshInvoiceHistory({ tenantId, bearer: accessToken })) {
          await localDb.entries.update(entry.id, {
            invoiceStatusOverride: undefined,
          });
        }
      } else {
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.pendingOps,
          async () => {
            await localDb.entries.update(entry.id, {
              invoiceStatusOverride: override,
              version: expectedVersion + 1,
              updatedAt: new Date().toISOString(),
            });
            await enqueuePendingOp({
              entityType: 'entry',
              operation: 'update',
              tenantId,
              entityId: entry.id,
              payload: {
                kind: 'correction',
                expectedVersion,
                body: { invoicePending: next },
              },
              status: 'pending',
            });
          },
        );
      }
      showToast({
        message: isOnline
          ? next
            ? 'Factura marcada como pendiente.'
            : 'Factura marcada como no facturada.'
          : 'Cambio guardado localmente. Se sincronizará al volver la conexión.',
        kind: 'success',
      });
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function saveManualNumber() {
    if (
      actionBusy ||
      manualNumberDraft.trim() === (current.manualInvoiceNumber ?? '')
    )
      return;
    setBusy('number');
    try {
      await saveEntryInlineField({
        tenantId,
        entryId: entry.id,
        accessToken,
        isOnline,
        field: 'manualInvoiceNumber',
        value: manualNumberDraft,
      });
      showToast({
        message: isOnline
          ? 'Número de factura guardado.'
          : 'Número de factura guardado localmente.',
        kind: 'success',
      });
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function saveExternalInvoice(
    details: Required<Pick<CorrectEntryDto, 'manuallyInvoiced'>> &
      Pick<
        CorrectEntryDto,
        | 'manualInvoiceType'
        | 'manualInvoicePointOfSale'
        | 'manualInvoiceNumber'
        | 'manualInvoiceArcaAccountId'
        | 'manualInvoiceIssuerCuit'
        | 'manualInvoiceIssuerName'
      >,
  ) {
    if (!isOnline || actionBusy) return;
    setBusy('external');
    try {
      const result = await correctEntry({
        tenantId,
        entryId: entry.id,
        expectedVersion: current.version,
        bearer: accessToken,
        body: details,
      });
      await localDb.transaction(
        'rw',
        localDb.entries,
        localDb.invoices,
        async () => {
          await localDb.entries.update(entry.id, {
            manuallyInvoiced: result.manuallyInvoiced,
            manualInvoiceType: result.manualInvoiceType ?? undefined,
            manualInvoicePointOfSale:
              result.manualInvoicePointOfSale ?? undefined,
            manualInvoiceNumber: result.manualInvoiceNumber ?? undefined,
            manualInvoiceArcaAccountId:
              result.manualInvoiceArcaAccountId ?? undefined,
            manualInvoiceIssuerCuit:
              result.manualInvoiceIssuerCuit ?? undefined,
            manualInvoiceIssuerName:
              result.manualInvoiceIssuerName ?? undefined,
            version: result.version,
            syncSeq: result.syncSeq,
            updatedAt: result.updatedAt,
          });
          if (
            invoice &&
            (invoice.status === 'pending' ||
              invoice.status === 'error' ||
              invoice.status === 'not_required')
          ) {
            await localDb.invoices.update(invoice.id, {
              status: 'not_required',
              errorCode: null,
              errorMessage: null,
            });
          }
        },
      );
      await refreshInvoiceHistory({ tenantId, bearer: accessToken });
      setExternalOpen(false);
      setRemoveExternalOpen(false);
      showToast({
        message: details.manuallyInvoiced
          ? 'Factura externa registrada.'
          : 'Registro de factura externa quitado.',
        kind: 'success',
      });
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="entry-invoice-section" aria-label="Factura">
      <h4>Factura</h4>
      <dl className="entry-invoice-rows">
        {(
          current.manuallyInvoiced
            ? current.manualInvoiceIssuerCuit || current.manualInvoiceIssuerName
            : invoice?.emisorCuit
        ) ? (
          <>
            <dt>Emisor</dt>
            <dd>
              {current.manuallyInvoiced
                ? current.manualInvoiceIssuerName
                : invoice?.emisorRazonSocial}{' '}
              {(
                current.manuallyInvoiced
                  ? current.manualInvoiceIssuerCuit
                  : invoice?.emisorCuit
              ) ? (
                <>
                  {' '}
                  · CUIT{' '}
                  {current.manuallyInvoiced
                    ? current.manualInvoiceIssuerCuit
                    : invoice?.emisorCuit}
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        <div className="entry-invoice-state">
          <dt>Estado</dt>
          <dd>
            <span className={`status-badge ${INVOICE_STATE_BADGE[state]}`}>
              {partialInvoice ? 'Factura parcial' : INVOICE_STATE_LABEL[state]}
            </span>
          </dd>
        </div>
        {partialInvoice ? (
          <>
            <dt>Facturado</dt>
            <dd>{formatArs(invoice!.impTotal)}</dd>
            <dt>Sin facturar</dt>
            <dd>{formatArs(paidTotal! - invoice!.impTotal)}</dd>
          </>
        ) : null}
        {hasVoucher && voucher ? (
          <>
            <dt>Comprobante</dt>
            <dd>{voucher}</dd>
          </>
        ) : null}
        {invoice?.cae ? (
          <>
            <dt>CAE</dt>
            <dd>{invoice.cae}</dd>
          </>
        ) : null}
        {invoice?.caeVto ? (
          <>
            <dt>Vencimiento del CAE</dt>
            <dd>{formatIsoDay(invoice.caeVto)}</dd>
          </>
        ) : null}
        {invoice && hasVoucher ? (
          <>
            <dt>Receptor</dt>
            <dd>{receiverDescription(invoice)}</dd>
          </>
        ) : null}
        {externalSaved ? (
          <>
            <dt>Comprobante externo</dt>
            <dd>
              {formatExternalInvoice(current) ?? 'Registrado fuera de Parkit'}
            </dd>
          </>
        ) : null}
      </dl>
      {canSelectAccount &&
      !externalOpen &&
      (accounts.length > 1 || (accountId && !account)) &&
      isUnbilled(state) ? (
        <InvoiceAccountSelector
          accounts={accounts}
          value={accountId}
          disabled={
            actionBusy || emitterLocked || confirmation.snapshot !== null
          }
          onChange={(id) => {
            confirmation.close();
            setAccountChoice(id);
          }}
        />
      ) : null}
      {showReminder ? (
        <div
          className="entry-invoice-reminder"
          aria-label="Seguimiento de factura"
        >
          <span className="entry-invoice-reminder-label">Seguimiento</span>
          <div
            className="entry-invoice-reminder-options"
            role="group"
            aria-label="Estado de seguimiento"
          >
            <button
              type="button"
              className={state === 'none' ? 'active' : ''}
              aria-pressed={state === 'none'}
              disabled={actionBusy}
              onClick={() => void setInvoicePending(false)}
            >
              <BellOff size={15} aria-hidden="true" /> No facturado
            </button>
            <button
              type="button"
              className={state === 'pending' ? 'active' : ''}
              aria-pressed={state === 'pending'}
              disabled={actionBusy}
              onClick={() => void setInvoicePending(true)}
            >
              <Bell size={15} aria-hidden="true" /> Pendiente
            </button>
          </div>
        </div>
      ) : null}
      {state === 'issued' ? (
        <ClientContact
          tenantId={tenantId}
          plate={current.plate}
          receiverCuit={
            invoice?.receptorDocTipo === 80 ? invoice.receptorDocNro : null
          }
        />
      ) : null}

      {errorText ? (
        <div className="entry-invoice-error" role="status">
          <p>{errorText}</p>
        </div>
      ) : null}

      {canIssue && issueOpen ? (
        <div className="entry-invoice-issue">
          {invoicePaymentOptions.length > 1 ? (
            <InvoicePaymentSelector
              options={invoicePaymentOptions}
              selectedIds={activePaymentIds}
              onChange={setSelectedPaymentIds}
              disabled={actionBusy}
            />
          ) : null}
          <InvoiceReceiverChooser
            receiver={receiver}
            emitter={emitter?.condicionIva}
            isOnline={isOnline}
            disabled={actionBusy}
            showLabel={false}
          />
          {(receiver.choice === 'final' || receiver.cuitToSend) && (
            <ClientContact
              tenantId={tenantId}
              plate={current.plate}
              receiverCuit={receiver.cuitToSend}
            />
          )}
          <div className="entry-invoice-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={actionBusy}
              onClick={() => setIssueOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={actionBusy || !isOnline || !receiver.ready}
              onClick={() =>
                void confirmation.open({
                  letter,
                  cuit: receiver.cuitToSend,
                  receiverName: receiver.receiverName,
                  arcaAccountId: accountId,
                  issuerLabel: account
                    ? invoiceAccountLabel(account)
                    : undefined,
                  ...(invoicePaymentOptions.length > 1
                    ? { invoicePaymentIds: activePaymentIds }
                    : {}),
                })
              }
            >
              {letter ? `Emitir Factura ${letter}` : 'Emitir factura'}
            </button>
          </div>
        </div>
      ) : null}

      <div
        className={`entry-invoice-actions${canIssue && !issueOpen && showExternal && !externalOpen ? ' entry-invoice-actions--choices' : ''}`}
      >
        {state === 'issued' ? (
          <button
            type="button"
            className="ghost-button"
            disabled={actionBusy || !isOnline}
            onClick={() => void downloadPdf()}
          >
            {busy === 'pdf' ? 'Descargando…' : 'Descargar PDF'}
          </button>
        ) : null}
        {state === 'issued' &&
        savedPdf &&
        savedPdf.invoiceId === invoice?.id &&
        window.parkitDesktop?.showSavedFileInFolder ? (
          <button
            type="button"
            className="ghost-button"
            title="Mostrar PDF en carpeta"
            aria-label="Mostrar PDF en carpeta"
            aria-busy={busy === 'folder'}
            disabled={actionBusy}
            onClick={() => void showPdfInFolder()}
          >
            <FolderOpen size={18} />
          </button>
        ) : null}
        {showManual ? (
          <Switch
            checked={state === 'manual'}
            disabled={actionBusy}
            onChange={(next) => void toggleManual(next)}
            label="Facturada"
          />
        ) : null}
        {showExternal && !externalOpen ? (
          <button
            type="button"
            className="ghost-button"
            disabled={actionBusy || !isOnline}
            onClick={() => {
              setIssueOpen(false);
              setExternalOtherIssuer(
                !current.manualInvoiceArcaAccountId &&
                  Boolean(
                    current.manualInvoiceIssuerCuit ||
                    current.manualInvoiceIssuerName,
                  ),
              );
              setExternalIssuerCuit(current.manualInvoiceIssuerCuit ?? '');
              setExternalIssuerName(current.manualInvoiceIssuerName ?? '');
              setExternalAccountChoice(undefined);
              setExternalOpen(true);
            }}
          >
            {externalSaved
              ? 'Editar factura externa'
              : 'Registrar factura externa'}
          </button>
        ) : null}
        {canIssue && !issueOpen ? (
          <button
            type="button"
            className="primary-button"
            disabled={actionBusy || !isOnline}
            onClick={() => setIssueOpen(true)}
          >
            {state === 'error' ? 'Reintentar' : 'Emitir factura'}
          </button>
        ) : null}
        {showExternal && externalSaved && !externalOpen ? (
          <button
            type="button"
            className="ghost-button"
            disabled={actionBusy || !isOnline}
            onClick={() => setRemoveExternalOpen(true)}
          >
            Quitar registro
          </button>
        ) : null}
        {!isOnline && (canIssue || state === 'issued') ? (
          <span className="muted">
            {state === 'issued'
              ? 'Necesitás conexión para descargar el PDF.'
              : 'Necesitás conexión para emitir la factura.'}
          </span>
        ) : null}
      </div>

      {showExternal && externalOpen ? (
        <div className="entry-external-invoice">
          <label className="entry-external-issuer-toggle">
            <input
              type="checkbox"
              checked={externalOtherIssuer}
              disabled={actionBusy}
              onChange={(event) => setExternalOtherIssuer(event.target.checked)}
            />
            Factura de otro emisor
          </label>
          {externalOtherIssuer ? (
            <div className="entry-external-issuer-fields">
              <label>
                CUIT del emisor
                <input
                  value={externalIssuerCuit}
                  inputMode="numeric"
                  maxLength={32}
                  placeholder="20-12345678-6"
                  disabled={actionBusy}
                  aria-invalid={Boolean(
                    normalizedIssuerCuit && !isValidCuit(normalizedIssuerCuit),
                  )}
                  onChange={(event) =>
                    setExternalIssuerCuit(event.target.value)
                  }
                />
              </label>
              <label>
                Nombre o razón social
                <input
                  value={externalIssuerName}
                  maxLength={180}
                  disabled={actionBusy}
                  onChange={(event) =>
                    setExternalIssuerName(event.target.value)
                  }
                />
              </label>
              {normalizedIssuerCuit && !isValidCuit(normalizedIssuerCuit) ? (
                <p className="entry-external-issuer-error" role="alert">
                  El CUIT no es válido.
                </p>
              ) : null}
            </div>
          ) : accounts.length > 0 ? (
            <InvoiceAccountSelector
              accounts={accounts}
              value={externalAccountId}
              onChange={setExternalAccountChoice}
              disabled={actionBusy}
            />
          ) : null}
          <div className="entry-external-invoice-fields">
            <label>
              Tipo
              <AppSelect
                value={externalType}
                onChange={(value) => setExternalType(value as 'A' | 'B' | 'C')}
                options={[
                  { value: 'A', label: 'Factura A' },
                  { value: 'B', label: 'Factura B' },
                  { value: 'C', label: 'Factura C' },
                ]}
                disabled={actionBusy}
              />
            </label>
            <label>
              Punto de venta
              <input
                inputMode="numeric"
                maxLength={5}
                value={externalPoint}
                disabled={actionBusy}
                onChange={(event) =>
                  setExternalPoint(event.target.value.replace(/\D/g, ''))
                }
              />
            </label>
            <label>
              Número
              <input
                inputMode="numeric"
                maxLength={8}
                value={externalNumber}
                disabled={actionBusy}
                onChange={(event) =>
                  setExternalNumber(event.target.value.replace(/\D/g, ''))
                }
              />
            </label>
          </div>
          <div className="entry-invoice-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={actionBusy}
              onClick={() => setExternalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={
                actionBusy ||
                !isOnline ||
                !externalIssuerValid ||
                !/^\d{1,5}$/.test(externalPoint) ||
                !/^\d{1,8}$/.test(externalNumber)
              }
              onClick={() =>
                void saveExternalInvoice({
                  manuallyInvoiced: true,
                  manualInvoiceType: externalType,
                  manualInvoicePointOfSale: externalPoint,
                  manualInvoiceNumber: externalNumber,
                  ...(externalOtherIssuer
                    ? {
                        manualInvoiceArcaAccountId: null,
                        manualInvoiceIssuerCuit: normalizedIssuerCuit || null,
                        manualInvoiceIssuerName:
                          externalIssuerName.trim() || null,
                      }
                    : { manualInvoiceArcaAccountId: externalAccountId }),
                })
              }
            >
              Guardar factura externa
            </button>
          </div>
        </div>
      ) : null}

      {showManual && state === 'manual' ? (
        <div className="entry-manual-invoice-number">
          <label htmlFor={`manual-invoice-number-${entry.id}`}>
            Número de factura
          </label>
          <div>
            <input
              id={`manual-invoice-number-${entry.id}`}
              type="text"
              value={manualNumberDraft}
              maxLength={40}
              disabled={actionBusy}
              onChange={(event) => setManualNumberDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void saveManualNumber();
                }
              }}
            />
            <button
              type="button"
              className="ghost-button"
              title="Guardar número de factura"
              aria-label="Guardar número de factura"
              disabled={
                actionBusy ||
                manualNumberDraft.trim() === (current.manualInvoiceNumber ?? '')
              }
              onClick={() => void saveManualNumber()}
            >
              <Save size={17} aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}

      {confirmation.snapshot ? (
        <ConfirmDialog
          open
          {...describeIssueConfirmation({
            ...confirmation.snapshot,
            amount: formatArs(confirmation.snapshot.amount),
          })}
          isPending={confirmation.busy}
          onCancel={confirmation.close}
          onConfirm={issue}
        />
      ) : null}
      {removeExternalOpen ? (
        <ConfirmDialog
          open
          title="Quitar factura externa"
          message="Parkit volverá a mostrar esta estadía como no facturada. Esto no modifica la factura emitida en ARCA."
          confirmLabel="Quitar registro"
          variant="warning"
          isPending={busy === 'external'}
          onCancel={() => setRemoveExternalOpen(false)}
          onConfirm={() =>
            void saveExternalInvoice({ manuallyInvoiced: false })
          }
        />
      ) : null}
    </section>
  );
}
