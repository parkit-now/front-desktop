import { useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { deleteEntry } from '../../lib/api/entries';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useToast } from '../../lib/notifications/ToastProvider';
import {
  entryToLocal,
  paymentTransactionToLocal,
} from '../../lib/sync/SyncService';
import { useEscapeKey } from '../../lib/ui/useEscapeKey';

interface Props {
  tenantId: string;
  accessToken: string;
  entry: LocalEntry;
  paidTotal: number | null;
  onClose: () => void;
}

export function EntryDeleteDialog({
  tenantId,
  accessToken,
  entry,
  paidTotal,
  onClose,
}: Props) {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEscapeKey(onClose, !busy);

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await deleteEntry({
        tenantId,
        entryId: entry.id,
        expectedVersion: entry.version,
        reason: reason.trim() || undefined,
        bearer: accessToken,
      });
      await localDb.transaction(
        'rw',
        localDb.entries,
        localDb.paymentTransactions,
        async () => {
          await localDb.entries.put(entryToLocal(result.entry));
          await localDb.paymentTransactions.bulkPut(
            result.deletedPaymentTransactions.map(paymentTransactionToLocal),
          );
        },
      );
      showToast({ message: 'Ingreso eliminado.', kind: 'success' });
      onClose();
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div
      className="confirm-dialog-backdrop entry-delete-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="confirm-dialog confirm-dialog-danger entry-delete-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="entry-delete-title"
        aria-describedby="entry-delete-description"
      >
        <div className="confirm-dialog-top">
          <span className="confirm-dialog-icon" aria-hidden="true">
            <Trash2 size={22} />
          </span>
          <button
            type="button"
            className="confirm-dialog-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar confirmación"
          >
            <X size={17} />
          </button>
        </div>
        <div>
          <p className="confirm-dialog-kicker">Confirmación</p>
          <h3 id="entry-delete-title">Eliminar ingreso</h3>
          <p id="entry-delete-description">
            Esta acción quitará el ingreso de las vistas y los cobros de la
            caja. No devuelve dinero automáticamente.
          </p>
        </div>
        <dl className="entry-delete-summary">
          <div>
            <dt>Patente</dt>
            <dd>{entry.plate}</dd>
          </div>
          <div>
            <dt>Ticket</dt>
            <dd>
              {entry.ticketNumber != null ? `#${entry.ticketNumber}` : '—'}
            </dd>
          </div>
          <div>
            <dt>Cobrado</dt>
            <dd>{paidTotal != null ? formatArs(paidTotal) : '—'}</dd>
          </div>
        </dl>
        <label className="entry-delete-reason">
          Motivo (opcional)
          <textarea
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
            disabled={busy}
          />
        </label>
        <div className="rate-dialog-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void confirm()}
            disabled={busy}
          >
            <Trash2 size={16} />
            {busy ? 'Eliminando…' : 'Eliminar ingreso'}
          </button>
        </div>
      </section>
    </div>
  );
}
