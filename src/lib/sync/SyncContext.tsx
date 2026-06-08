import { useLiveQuery } from 'dexie-react-hooks';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { translateApiError } from '../api/translate';
import { localDb } from '../db/localDb';
import { useNetwork } from '../network/NetworkContext';
import { useToast } from '../notifications/ToastProvider';
import { syncService } from './SyncService';

interface SyncContextValue {
  pendingCount: number;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  syncError: string | null;
  triggerSync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  pendingCount: 0,
  isSyncing: false,
  lastSyncAt: null,
  syncError: null,
  triggerSync: async () => {},
});

interface Props {
  tenantId: string | null;
  accessToken: string;
  children: React.ReactNode;
}

export function SyncProvider({ tenantId, accessToken, children }: Props) {
  const { isOnline } = useNetwork();
  const { showToast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const wasOfflineRef = useRef(!isOnline);
  const syncInFlightRef = useRef(false);

  const pendingCount =
    useLiveQuery(
      () =>
        tenantId
          ? localDb.pendingOps
              .where('[tenantId+status]')
              .anyOf([
                [tenantId, 'pending'],
                [tenantId, 'failed'],
              ])
              .count()
          : Promise.resolve(0),
      [tenantId],
    ) ?? 0;

  const triggerSync = useCallback(async () => {
    if (!tenantId || !accessToken || syncInFlightRef.current) return;

    syncService.setCredentials(tenantId, accessToken);
    syncInFlightRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    try {
      await syncService.fullSync();
      setLastSyncAt(new Date());
    } catch (error) {
      const message = translateApiError(error);
      setSyncError(message);
      showToast({ message: `Error al sincronizar: ${message}`, kind: 'error' });
    } finally {
      setIsSyncing(false);
      syncInFlightRef.current = false;
    }
  }, [tenantId, accessToken, showToast]);

  // Sync when credentials change (login or tenant switch)
  useEffect(() => {
    if (!tenantId || !accessToken || !isOnline) return;
    void triggerSync();
  }, [tenantId, accessToken]); // intentionally omits triggerSync to avoid re-triggering on every render

  // Sync when coming back online
  useEffect(() => {
    const wasOffline = wasOfflineRef.current;
    wasOfflineRef.current = !isOnline;

    if (isOnline && wasOffline && tenantId && accessToken) {
      void triggerSync();
    }
  }, [isOnline, tenantId, accessToken, triggerSync]);

  return (
    <SyncContext.Provider
      value={{ pendingCount, isSyncing, lastSyncAt, syncError, triggerSync }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
