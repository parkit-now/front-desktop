import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import QRCode from 'qrcode';
import { getInvoiceDocument, issueInvoice } from '../../lib/api/arca';
import { correctEntry } from '../../lib/api/entries';
import { translateApiError, translateErrorCode } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useToast } from '../../lib/notifications/ToastProvider';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { syncService } from '../../lib/sync/SyncService';
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

/**
 * Arma el PDF del comprobante con el Chromium de Electron y lo ofrece con
 * «Guardar como…». `false` si la persona canceló el diálogo.
 */
async function savePdf(fileName: string, html: string): Promise<boolean> {
  const desktop = window.parkitDesktop;
  if (!desktop?.renderPdf || !desktop.saveFile) {
    // Renderer abierto en un navegador (dev sin Electron): el diálogo de
    // impresión del navegador deja guardarlo como PDF.
    const preview = window.open('', '_blank');
    if (!preview) throw new Error('popup-blocked');
    preview.document.write(html);
    preview.document.close();
    preview.print();
    return false;
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
  return result.ok;
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
  const [busy, setBusy] = useState<'issue' | 'pdf' | 'manual' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // «Emitir factura» abre primero el receptor (consumidor final o CUIT).
  const [issueOpen, setIssueOpen] = useState(false);
  const receiver = useInvoiceReceiver({ tenantId, accessToken, isOnline });
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
    setBusy('issue');
    try {
      const result = await issueInvoice({
        tenantId,
        entryId: entry.id,
        bearer: accessToken,
        receiverCuit: receiver.cuitToSend,
      });
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
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setBusy(null);
      setConfirmOpen(false);
      // La fila completa (CAE, receptor, número) llega por el feed de sync.
      void syncService.pullInvoices().catch(() => undefined);
    }
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
        if (saved) showToast({ message: 'PDF guardado.', kind: 'success' });
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
          version: result.version,
          syncSeq: result.syncSeq,
          updatedAt: result.updatedAt,
        });
      } else {
        await localDb.transaction(
          'rw',
          localDb.entries,
          localDb.pendingOps,
          async () => {
            await localDb.entries.update(entry.id, {
              manuallyInvoiced: next,
              version: current.version + 1,
              updatedAt: new Date().toISOString(),
            });
            await enqueuePendingOp({
              entityType: 'entry',
              operation: 'update',
              tenantId,
              entityId: entry.id,
              payload: {
                kind: 'correction',
                expectedVersion: current.version,
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
            disabled={busy !== null}
            showLabel={false}
          />
          <div className="entry-invoice-actions">
            <button
              type="button"
              className="ghost-button"
              disabled={busy !== null}
              onClick={() => setIssueOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy !== null || !isOnline || !receiver.ready}
              onClick={() => setConfirmOpen(true)}
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
            disabled={busy !== null || !isOnline}
            onClick={() => void downloadPdf()}
          >
            {busy === 'pdf' ? 'Descargando…' : 'Descargar PDF'}
          </button>
        ) : null}
        {canIssue && !issueOpen ? (
          <button
            type="button"
            className="primary-button"
            disabled={busy !== null || !isOnline}
            onClick={() => setIssueOpen(true)}
          >
            {state === 'error' ? 'Reintentar' : 'Emitir factura'}
          </button>
        ) : null}
        {showManual ? (
          <Switch
            checked={state === 'manual'}
            disabled={busy !== null}
            onChange={(next) => void toggleManual(next)}
            label="Facturada"
          />
        ) : null}
        {!isOnline && (canIssue || state === 'issued') ? (
          <span className="muted">Necesitás conexión para esto.</span>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        {...describeIssueConfirmation({
          letter,
          cuit: receiver.cuitToSend,
          receiverName: receiver.receiverName,
          amount: formatArs(paidTotal ?? 0),
        })}
        isPending={busy === 'issue'}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={issue}
      />
    </section>
  );
}
