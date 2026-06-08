import { RefreshCw } from 'lucide-react';
import { useSync } from '../../lib/sync/SyncContext';
import { useNetwork } from '../../lib/network/NetworkContext';

interface Props {
  collapsed?: boolean;
}

export function SyncButton({ collapsed = false }: Props) {
  const { pendingCount, isSyncing, lastSyncAt, syncError, triggerSync } =
    useSync();
  const { isOnline } = useNetwork();

  const hasPending = pendingCount > 0;

  let statusClass = 'sync-button';
  if (!isOnline) statusClass += ' sync-button--offline';
  else if (syncError) statusClass += ' sync-button--error';
  else if (hasPending) statusClass += ' sync-button--pending';
  else statusClass += ' sync-button--ok';

  const title = !isOnline
    ? 'Sin conexión'
    : isSyncing
      ? 'Sincronizando...'
      : syncError
        ? `Error al sincronizar · Reintentar`
        : hasPending
          ? `${pendingCount} cambio${pendingCount === 1 ? '' : 's'} pendiente${pendingCount === 1 ? '' : 's'}`
          : lastSyncAt
            ? `Sincronizado ${lastSyncAt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`
            : 'Sincronizar';

  return (
    <button
      type="button"
      className={statusClass}
      onClick={() => {
        if (isOnline && !isSyncing) void triggerSync();
      }}
      disabled={!isOnline || isSyncing}
      title={title}
      aria-label={title}
    >
      <RefreshCw
        size={16}
        aria-hidden="true"
        className={isSyncing ? 'spin' : ''}
      />
      {!collapsed && <span className="sync-button-label">{title}</span>}
      {!collapsed && hasPending && !isSyncing && (
        <span className="sync-badge">{pendingCount}</span>
      )}
    </button>
  );
}
