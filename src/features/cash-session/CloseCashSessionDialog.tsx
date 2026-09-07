import { useState } from 'react';
import { X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { closeCashSession } from '../../lib/api/cash-sessions';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalCashSession } from '../../lib/db/localDb';
import { useToast } from '../../lib/notifications/ToastProvider';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
import { generateUuidV7 } from '../entries/entryUtils';
import { computeSessionSummary } from './cashSessionUtils';

interface Props {
  tenantId: string;
  accessToken: string;
  session: LocalCashSession;
  onClose: () => void;
}

export function CloseCashSessionDialog({
  tenantId,
  accessToken,
  session,
  onClose,
}: Props) {
  const { showToast } = useToast();
  const [leaveFund, setLeaveFund] = useState(false);
  const [leavingCash, setLeavingCash] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const transactions = useLiveQuery(
    () =>
      localDb.paymentTransactions
        .where('cashSessionId')
        .equals(session.id)
        .toArray(),
    [session.id],
  );

  const summary = computeSessionSummary(
    transactions ?? [],
    session.openingCash,
  );

  async function handleClose(): Promise<void> {
    setSaving(true);
    const newSessionId = generateUuidV7();
    const leaving = leaveFund
      ? parseFloat(leavingCash.replace(',', '.')) || 0
      : 0;

    try {
      const result = await closeCashSession({
        tenantId,
        bearer: accessToken,
        sessionId: session.id,
        body: {
          newSessionId,
          leavingCash: leaving,
          notes: notes.trim() || undefined,
        },
      });

      // Find active entries from the old session to mirror server-side carry-over
      const activeEntries = await localDb.entries
        .where('cashSessionId')
        .equals(session.id)
        .filter((e) => !e.leftAt)
        .toArray();
      activeEntries.sort(
        (a, b) =>
          new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime(),
      );

      await localDb.transaction(
        'rw',
        localDb.cashSessions,
        localDb.entries,
        async () => {
          await localDb.cashSessions.put({
            id: result.closedSession.id,
            tenantId: result.closedSession.tenantId,
            openedAt: result.closedSession.openedAt,
            closedAt: result.closedSession.closedAt ?? undefined,
            openingCash: result.closedSession.openingCash,
            leavingCash: result.closedSession.leavingCash ?? undefined,
            notes: result.closedSession.notes ?? undefined,
            version: result.closedSession.version,
            syncSeq: result.closedSession.syncSeq,
            updatedAt: result.closedSession.updatedAt,
          });
          await localDb.cashSessions.put({
            id: result.newSession.id,
            tenantId: result.newSession.tenantId,
            openedAt: result.newSession.openedAt,
            closedAt: result.newSession.closedAt ?? undefined,
            openingCash: result.newSession.openingCash,
            leavingCash: result.newSession.leavingCash ?? undefined,
            notes: result.newSession.notes ?? undefined,
            version: result.newSession.version,
            syncSeq: result.newSession.syncSeq,
            updatedAt: result.newSession.updatedAt,
          });
          // Replicate server carry-over: reassign cashSessionId + renumber
          for (let i = 0; i < activeEntries.length; i++) {
            await localDb.entries.update(activeEntries[i].id, {
              cashSessionId: result.newSession.id,
              ticketNumber: i + 1,
            });
          }
        },
      );

      const msg =
        result.carriedOverCount > 0
          ? `Caja cerrada. ${result.carriedOverCount} vehículo${result.carriedOverCount > 1 ? 's' : ''} traspasado${result.carriedOverCount > 1 ? 's' : ''} al nuevo turno.`
          : 'Caja cerrada. Nueva caja abierta automáticamente.';
      showToast({ message: msg, kind: 'success' });
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
        className="rate-dialog close-session-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-session-title"
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">Cerrar caja</p>
            <h3 id="close-session-title">Resumen del turno</h3>
            <p className="muted">
              Abierta: {formatArgentinaDateTime(session.openedAt)}
            </p>
          </div>
          <button
            type="button"
            className="rate-dialog-close"
            onClick={onClose}
            disabled={saving}
            aria-label="Cancelar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="session-summary">
          {summary.byPm.length === 0 ? (
            <p className="muted">Sin movimientos en este turno.</p>
          ) : (
            summary.byPm.map((pm) => {
              const isEfectivo = pm.isCash;
              return (
                <div key={pm.pmId} className="session-pm-row">
                  <div className="session-pm-header">
                    <span className="session-pm-name">{pm.pmName}</span>
                    <span className="session-pm-total">
                      {formatArs(pm.total)}
                    </span>
                  </div>
                  {isEfectivo && session.openingCash > 0 && (
                    <div className="session-pm-breakdown">
                      <span className="muted">
                        Fondo inicial: {formatArs(session.openingCash)}
                      </span>
                      <span className="muted">
                        Cobrado: {formatArs(pm.total)}
                      </span>
                      <span className="session-pm-total-label">
                        Total en caja:{' '}
                        {formatArs(session.openingCash + pm.total)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {session.openingCash > 0 &&
            summary.byPm.every((pm) => !pm.isCash) && (
              <p className="muted session-opening-cash-note">
                Fondo inicial sin movimientos en efectivo:{' '}
                {formatArs(session.openingCash)}
              </p>
            )}
        </div>

        <div className="session-close-options">
          <label className="session-leave-fund-label">
            <input
              type="checkbox"
              checked={leaveFund}
              onChange={(e) => setLeaveFund(e.target.checked)}
            />
            <span>Dejar fondo para el siguiente turno</span>
          </label>

          {leaveFund && (
            <div className="form-field">
              <label className="form-label">Efectivo a dejar (ARS)</label>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={leavingCash}
                onChange={(e) => setLeavingCash(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="form-field">
            <label className="form-label">Notas (opcional)</label>
            <input
              type="text"
              placeholder="Observaciones del turno..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

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
            className="primary-button compact danger-button"
            onClick={() => void handleClose()}
            disabled={saving}
          >
            {saving ? 'Cerrando...' : 'Cerrar caja'}
          </button>
        </div>
      </section>
    </div>
  );
}
