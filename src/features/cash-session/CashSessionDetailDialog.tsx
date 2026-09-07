import { History, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { updateCashSession } from '../../lib/api/cash-sessions';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalCashSession } from '../../lib/db/localDb';
import { cashSessionLabel } from '../../lib/format/cashSession';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { cashSessionToLocal } from '../../lib/sync/SyncService';
import { useSync } from '../../lib/sync/SyncContext';
import { CashSessionStats } from './CashSessionStats';

interface Props {
  session: LocalCashSession;
  tenantId: string;
  accessToken: string;
  onClose: () => void;
  onViewMovements?: (session: LocalCashSession) => void;
}

export function CashSessionDetailDialog({
  session,
  tenantId,
  accessToken,
  onClose,
  onViewMovements,
}: Props) {
  const { isOnline } = useNetwork();
  const { triggerSync } = useSync();
  const { showToast } = useToast();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const saveNotes = useCallback(
    async (notes: string): Promise<void> => {
      try {
        if (isOnline) {
          const result = await updateCashSession({
            tenantId,
            bearer: accessToken,
            sessionId: session.id,
            expectedVersion: session.version,
            body: { notes },
          });
          await localDb.cashSessions.put(cashSessionToLocal(result));
        } else {
          await localDb.transaction(
            'rw',
            [localDb.cashSessions, localDb.pendingOps],
            async () => {
              await localDb.cashSessions.update(session.id, {
                notes: notes || undefined,
                updatedAt: new Date().toISOString(),
              });
              await localDb.pendingOps.add({
                entityType: 'cashSession',
                operation: 'update',
                tenantId,
                entityId: session.id,
                payload: {
                  expectedVersion: session.version,
                  body: { notes },
                },
                status: 'pending',
                createdAt: Date.now(),
                retryCount: 0,
              });
            },
          );
        }
        showToast({ message: 'Nota guardada.', kind: 'success' });
      } catch (error) {
        showToast({ message: translateApiError(error), kind: 'error' });
        if (isOnline) void triggerSync();
        throw error;
      }
    },
    [
      accessToken,
      isOnline,
      session.id,
      session.version,
      showToast,
      tenantId,
      triggerSync,
    ],
  );

  return (
    <div
      className="rate-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="rate-dialog cash-session-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cash-session-detail-title"
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">
              {session.closedAt ? 'Caja cerrada' : 'Caja activa'}
            </p>
            <h3 id="cash-session-detail-title">{cashSessionLabel(session)}</h3>
          </div>
          <button
            type="button"
            className="rate-dialog-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>

        <CashSessionStats session={session} onSaveNotes={saveNotes} />

        <div className="rate-dialog-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cerrar
          </button>
          {onViewMovements ? (
            <button
              type="button"
              className="primary-button compact"
              onClick={() => onViewMovements(session)}
            >
              <History size={15} aria-hidden="true" />
              Ver movimientos en el historial
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
