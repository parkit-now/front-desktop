import { RefreshCw } from 'lucide-react';
import { useSync } from '../../lib/sync/SyncContext';
import { useNetwork } from '../../lib/network/NetworkContext';

interface Props {
  collapsed?: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function SyncButton({ collapsed = false }: Props) {
  const {
    pendingCount,
    blockedCount,
    otherOperatorCount,
    isSyncing,
    lastSyncAt,
    syncError,
    triggerSync,
  } = useSync();
  const { isOnline } = useNetwork();

  const hasPending = pendingCount > 0;
  // Estas no se arreglan reintentando: un 409 con el mismo `expectedVersion`
  // vuelve a dar 409, y un payload inválido va a seguir siendo inválido.
  const hasBlocked = blockedCount > 0;
  const unsynced = pendingCount + blockedCount;

  let statusClass = 'sync-button';
  if (!isOnline) statusClass += ' sync-button--offline';
  else if (syncError || hasBlocked) statusClass += ' sync-button--error';
  else if (hasPending) statusClass += ' sync-button--pending';
  else statusClass += ' sync-button--ok';

  const syncedAt = lastSyncAt
    ? `Sincronizado ${lastSyncAt.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })}`
    : 'Sincronizar';

  const label = !isOnline
    ? 'Sin conexión'
    : isSyncing
      ? 'Sincronizando...'
      : hasBlocked
        ? 'Requiere revisión'
        : syncError
          ? 'Error al sincronizar'
          : hasPending
            ? 'Cambios pendientes'
            : syncedAt;

  const details: string[] = [];
  if (hasPending) {
    details.push(
      plural(pendingCount, 'cambio pendiente', 'cambios pendientes'),
    );
  }
  if (hasBlocked) {
    details.push(
      blockedCount === 1
        ? '1 cambio que no se pudo sincronizar'
        : `${blockedCount} cambios que no se pudieron sincronizar`,
    );
  }
  if (otherOperatorCount > 0) {
    details.push(
      `${plural(otherOperatorCount, 'corresponde', 'corresponden')} a otro operador`,
    );
  }

  const title = !isOnline
    ? details.length > 0
      ? `Sin conexión · ${details.join(' · ')}`
      : 'Sin conexión'
    : isSyncing
      ? 'Sincronizando...'
      : details.length > 0
        ? `${details.join(' · ')} · Reintentar`
        : syncError
          ? 'Error al sincronizar · Reintentar'
          : syncedAt;

  return (
    <button
      type="button"
      className={statusClass}
      onClick={() => {
        // `ignoreBackoff`: el operador apretó el botón, espera que salga algo
        // ahora y no ve el backoff interno.
        if (isOnline && !isSyncing) void triggerSync({ ignoreBackoff: true });
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
      {!collapsed && <span className="sync-button-label">{label}</span>}
      {!collapsed && unsynced > 0 && !isSyncing && (
        <span className="sync-badge">{unsynced}</span>
      )}
    </button>
  );
}
