import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../lib/db/localDb';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
import { computeSessionSummary } from './cashSessionUtils';
import { CloseCashSessionDialog } from './CloseCashSessionDialog';

interface Props {
  tenantId: string;
  accessToken: string;
}

export function CashSessionPanel({ tenantId, accessToken }: Props) {
  const [showCloseDialog, setShowCloseDialog] = useState(false);

  const activeSession = useLiveQuery(
    () =>
      localDb.cashSessions
        .where('tenantId')
        .equals(tenantId)
        .filter((s) => !s.closedAt)
        .first(),
    [tenantId],
  );

  const transactions = useLiveQuery(
    () =>
      activeSession
        ? localDb.paymentTransactions
            .where('cashSessionId')
            .equals(activeSession.id)
            .toArray()
        : Promise.resolve(
            [] as import('../../lib/db/localDb').LocalPaymentTransaction[],
          ),
    [activeSession?.id],
  );

  if (activeSession === undefined) {
    return <p className="muted">Cargando...</p>;
  }

  if (!activeSession) {
    return (
      <div className="dashboard-card">
        <h2>Sin caja activa</h2>
        <p className="muted">Abrí una caja desde el panel operativo.</p>
      </div>
    );
  }

  const summary = computeSessionSummary(
    transactions ?? [],
    activeSession.openingCash,
  );

  return (
    <div className="cash-session-panel">
      <div className="cash-session-header">
        <div>
          <h2 className="cash-session-title">Caja activa</h2>
          <p className="muted">
            Abierta: {formatArgentinaDateTime(activeSession.openedAt)}
          </p>
          {activeSession.openingCash > 0 && (
            <p className="muted">
              Fondo inicial: {formatArs(activeSession.openingCash)}
            </p>
          )}
        </div>
        <button
          type="button"
          className="ghost-button danger-button"
          onClick={() => setShowCloseDialog(true)}
        >
          Cerrar caja
        </button>
      </div>

      <div className="session-summary-cards">
        {summary.byPm.length === 0 ? (
          <p className="muted">Sin cobros registrados en este turno.</p>
        ) : (
          summary.byPm.map((pm) => {
            const isEfectivo = pm.pmName.toLowerCase().includes('efectivo');
            return (
              <div key={pm.pmName} className="session-pm-card">
                <span className="session-pm-card-name">{pm.pmName}</span>
                <span className="session-pm-card-total">
                  {formatArs(pm.total)}
                </span>
                {isEfectivo && activeSession.openingCash > 0 && (
                  <div className="session-pm-card-breakdown">
                    <span>Fondo: {formatArs(activeSession.openingCash)}</span>
                    <span>
                      Total en caja:{' '}
                      {formatArs(activeSession.openingCash + pm.total)}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {showCloseDialog && (
        <CloseCashSessionDialog
          tenantId={tenantId}
          accessToken={accessToken}
          session={activeSession}
          onClose={() => setShowCloseDialog(false)}
        />
      )}
    </div>
  );
}
