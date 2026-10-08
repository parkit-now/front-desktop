import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { FolderOpen, Save } from 'lucide-react';
import QRCode from 'qrcode';
import { getInvoiceDocument } from '../../lib/api/arca';
import { correctEntry } from '../../lib/api/entries';
import { translateApiError, translateErrorCode } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useToast } from '../../lib/notifications/ToastProvider';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { ConfirmDialog } from '../../lib/ui/ConfirmDialog';
import { Switch } from '../../lib/ui/Switch';
import { renderInvoiceHtml } from './invoiceDocument';
import { InvoiceReceiverChooser } from './InvoiceReceiverChooser';
import {
  describeIssueConfirmation,
  expectedLetter,
  formatIsoDay,
  INVOICE_STATE_BADGE,
  INVOICE_STATE_LABEL,
  invoicePdfFileName,
  isUnbilled,
  receiverDescription,
  resolveInvoiceState,
  voucherLabel,
} from './invoiceUtils';
import type { ArcaEmitter } from './useArcaEmitter';
import { useInvoiceReceiver } from './useInvoiceReceiver';
import { useInvoiceConfirmation } from './useInvoiceConfirmation';
import { saveEntryInlineField } from './entryInlineFields';

/**
 * Arma el PDF del comprobante con el Chromium de Electron y lo ofrece con
 * «Guardar como…». Devuelve la ruta o `null` si no se guardó en Electron.
 */
async function savePdf(fileName: string, html: string): Promise<string | null> {
  const desktop = window.parkitDesktop;
  if (!desktop?.renderPdf || !desktop.saveFile) {
    // Renderer abierto en un navegador (dev sin Electron): el diálogo de
    // impresión del navegador deja guardarlo como PDF.
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('popup-blocked');
    preview.document.write(html);
    preview.document.close();
    preview.print();
    return null;
  }
  const pdf = await desktop.renderPdf({ html });
  if (!pdf.ok) throw new Error(pdf.detail ?? pdf.reason);
  const result = await desktop.saveFile({
    defaultName: fileName,
    data: pdf.data,
  });
  if (!result.ok && result.reason === 'write-failed') {
    throw new Error(result.detail ?? 'write-failed');
  }
  return result.ok ? result.path : null;
}

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
  paidTotal,
  tenantId,
  accessToken,
  isOnline,
  emitter,
}: {
  entry: LocalEntry;
  paidTotal: number | null;
  tenantId: string;
  accessToken: string;
  isOnline: boolean;
  /** `null` = la playa no factura con ARCA. */
  emitter: ArcaEmitter | null;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<
    'pdf' | 'manual' | 'number' | 'folder' | null
  >(null);
  const [manualNumberDraft, setManualNumberDraft] = useState(
    entry.manualInvoiceNumber ?? '',
  );
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
  const receiver = useInvoiceReceiver({
    tenantId,
    accessToken,
    isOnline,
    plate: entry.plate,
    entryId: entry.id,
    suggestionEnabled: issueOpen,
    frozen: actionBusy || confirmation.snapshot !== null,
  });
  const invoice = useLiveQuery(
    () => localDb.invoices.where('entryId').equals(entry.id).first(),
    [entry.id],
  );
  // Se lee de Dexie y no del prop: el prop es la fila de cuando se abrió el
  // diálogo, y el checkbox la cambia.
  const liveEntry = useLiveQuery(
    () => localDb.entries.get(entry.id),
    [entry.id],
  );
  const current = liveEntry ?? entry;

  useEffect(() => {
    setManualNumberDraft(current.manualInvoiceNumber ?? '');
  }, [entry.id, current.manualInvoiceNumber]);

  const state = resolveInvoiceState(
    {
      leftAt: current.leftAt,
      paidTotal,
      manuallyInvoiced: current.manuallyInvoiced,
    },
    invoice,
  );
  if (state === 'na' && !invoice) return null;

  const hasVoucher = state === 'issued' || state === 'issuing';
  const voucher = invoice ? voucherLabel(invoice) : null;
  const errorText =
    invoice && (state === 'error' || state === 'pending')
      ? (translateErrorCode(invoice.errorCode) ??
        (state === 'error' ? 'No se pudo emitir.' : null))
      : null;
  const canIssue = emitter !== null && isUnbilled(state);
  const showManual =
    emitter === null && (state === 'none' || state === 'manual');
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
        const saved = await savePdf(
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

  return (
    <section className="entry-invoice-section" aria-label="Factura">
      <h4>Factura</h4>
      <dl className="entry-invoice-rows">
        <dt>Estado</dt>
        <dd>
          <span className={`status-badge ${INVOICE_STATE_BADGE[state]}`}>
            {INVOICE_STATE_LABEL[state]}
          </span>
        </dd>
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
      </dl>

      {errorText ? (
        <div className="entry-invoice-error" role="status">
          <p>{errorText}</p>
        </div>
      ) : null}

      {canIssue && issueOpen ? (
        <div className="entry-invoice-issue">
          <InvoiceReceiverChooser
            receiver={receiver}
            emitter={emitter?.condicionIva}
            isOnline={isOnline}
            disabled={actionBusy}
            showLabel={false}
          />
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
                })
              }
            >
              {letter ? `Emitir Factura ${letter}` : 'Emitir factura'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="entry-invoice-actions">
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
        {showManual ? (
          <Switch
            checked={state === 'manual'}
            disabled={actionBusy}
            onChange={(next) => void toggleManual(next)}
            label="Facturada"
          />
        ) : null}
        {!isOnline && (canIssue || state === 'issued') ? (
          <span className="muted">
            {state === 'issued'
              ? 'Necesitás conexión para descargar el PDF.'
              : 'Necesitás conexión para emitir la factura.'}
          </span>
        ) : null}
      </div>

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
    </section>
  );
}
