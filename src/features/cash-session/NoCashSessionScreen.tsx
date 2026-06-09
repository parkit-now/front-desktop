import { useState } from 'react';
import { createCashSession } from '../../lib/api/cash-sessions';
import { translateApiError } from '../../lib/api/translate';
import { localDb, type LocalCashSession } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { generateUuidV7 } from '../entries/entryUtils';

interface Props {
  tenantId: string;
  accessToken: string;
}

export function NoCashSessionScreen({ tenantId, accessToken }: Props) {
  const { showToast } = useToast();
  const { isOnline } = useNetwork();
  const [openingCash, setOpeningCash] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleOpen(): Promise<void> {
    setSaving(true);
    const sessionId = generateUuidV7();
    const now = new Date().toISOString();
    const cash = parseFloat(openingCash.replace(',', '.')) || 0;

    try {
      if (isOnline) {
        const result = await createCashSession({
          tenantId,
          bearer: accessToken,
          body: { id: sessionId, openedAt: now, openingCash: cash },
        });
        const local: LocalCashSession = {
          id: result.id,
          tenantId: result.tenantId,
          openedAt: result.openedAt,
          closedAt: result.closedAt ?? undefined,
          openingCash: result.openingCash,
          leavingCash: result.leavingCash ?? undefined,
          notes: result.notes ?? undefined,
          version: result.version,
          syncSeq: result.syncSeq,
          updatedAt: result.updatedAt,
        };
        await localDb.cashSessions.put(local);
      } else {
        const local: LocalCashSession = {
          id: sessionId,
          tenantId,
          openedAt: now,
          openingCash: cash,
          version: 1,
          syncSeq: 0,
          updatedAt: now,
        };
        await localDb.transaction(
          'rw',
          localDb.cashSessions,
          localDb.pendingOps,
          async () => {
            await localDb.cashSessions.put(local);
            await localDb.pendingOps.add({
              entityType: 'cashSession',
              operation: 'create',
              tenantId,
              entityId: sessionId,
              payload: { id: sessionId, openedAt: now, openingCash: cash },
              status: 'pending',
              createdAt: Date.now(),
              retryCount: 0,
            });
          },
        );
      }

      showToast({ message: 'Caja abierta', kind: 'success' });
    } catch (error) {
      showToast({ message: translateApiError(error), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="no-session-screen">
      <div className="no-session-card">
        <p className="no-session-icon">🧾</p>
        <h3 className="no-session-title">No hay una caja abierta</h3>
        <p className="muted">Abrí la caja para registrar ingresos y egresos.</p>

        <div className="no-session-form">
          <div className="form-field">
            <label className="form-label">Efectivo inicial (ARS)</label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleOpen();
              }}
              autoFocus
            />
            <p className="form-helper">
              Dejá en 0 si no recibís cambio al comenzar el turno.
            </p>
          </div>

          <button
            type="button"
            className="primary-button"
            onClick={() => void handleOpen()}
            disabled={saving}
          >
            {saving ? 'Abriendo...' : 'Abrir caja'}
          </button>
        </div>
      </div>
    </div>
  );
}
