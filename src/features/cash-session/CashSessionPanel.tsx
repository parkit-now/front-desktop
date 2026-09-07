import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { History } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { formatArgentinaDateTime } from '../../lib/format/argentina';
import { CashSessionStats } from './CashSessionStats';
import { CloseCashSessionDialog } from './CloseCashSessionDialog';

interface Props {
  tenantId: string;
  accessToken: string;
  onViewMovements?: () => void;
}

export function CashSessionPanel({
  tenantId,
  accessToken,
  onViewMovements,
}: Props) {
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

  return (
    <div className="cash-session-panel">
      <div className="cash-session-header">
        <div>
          <h2 className="cash-session-title">Caja activa</h2>
          <p className="muted">
            Abierta: {formatArgentinaDateTime(activeSession.openedAt)}
          </p>
        </div>
        <div className="cash-session-header-actions">
          {onViewMovements ? (
            <button
              type="button"
              className="ghost-button compact"
              onClick={onViewMovements}
            >
              <History size={15} aria-hidden="true" />
              Ver movimientos en el historial
            </button>
          ) : null}
          <button
            type="button"
            className="ghost-button danger-button"
            onClick={() => setShowCloseDialog(true)}
          >
            Cerrar caja
          </button>
        </div>
      </div>

      <CashSessionStats session={activeSession} />

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
