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
import { supabase } from '../supabase/client';
import { setEnqueueUserId } from './enqueue';
import { syncService } from './SyncService';

interface SyncContextValue {
  pendingCount: number;
  /** Ops que necesitan a una persona: conflicto de versión o payload inválido. */
  blockedCount: number;
  /**
   * Ops sin sincronizar que encoló OTRO operador en este equipo (cambio de
   * turno con la red caída). Vale avisarlo: se van a pushear con la sesión de
   * quien esté logueado ahora.
   */
  otherOperatorCount: number;
  isSyncing: boolean;
  lastSyncAt: Date | null;
  syncError: string | null;
  triggerSync: (options?: { ignoreBackoff?: boolean }) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue>({
  pendingCount: 0,
  blockedCount: 0,
  otherOperatorCount: 0,
  isSyncing: false,
  lastSyncAt: null,
  syncError: null,
  triggerSync: async () => {},
});

interface Props {
  tenantId: string | null;
  accessToken: string;
  /** Autor de las operaciones que se encolen mientras esta sesión esté activa. */
  userId: string;
  children: React.ReactNode;
}

export function SyncProvider({
  tenantId,
  accessToken,
  userId,
  children,
}: Props) {
  const { isOnline } = useNetwork();
  const { showToast } = useToast();
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const wasOfflineRef = useRef(!isOnline);
  const syncInFlightRef = useRef(false);

  // Toda op encolada desde acá queda con su autor. Ver `enqueuePendingOp`.
  useEffect(() => {
    setEnqueueUserId(userId);
    return () => {
      setEnqueueUserId(null);
    };
  }, [userId]);

  // Pendientes "sanas": el sync las va a reintentar solo.
  const pendingCount =
    useLiveQuery(
      () =>
        tenantId
          ? localDb.pendingOps
              .where('[tenantId+status]')
              .equals([tenantId, 'pending'])
              .count()
          : Promise.resolve(0),
      [tenantId],
    ) ?? 0;

  // Trabadas de verdad. Antes iban juntas con las pendientes en un solo
  // contador que no bajaba nunca, así que el operador no podía distinguir
  // "esperá que sincroniza" de "esto necesita que hagas algo".
  const blockedCount =
    useLiveQuery(
      () =>
        tenantId
          ? localDb.pendingOps
              .where('[tenantId+status]')
              .anyOf([
                [tenantId, 'conflict'],
                [tenantId, 'failed'],
              ])
              .count()
          : Promise.resolve(0),
      [tenantId],
    ) ?? 0;

  const otherOperatorCount =
    useLiveQuery(async () => {
      if (!tenantId) return 0;
      const rows = await localDb.pendingOps
        .where('[tenantId+status]')
        .anyOf([
          [tenantId, 'pending'],
          [tenantId, 'conflict'],
          [tenantId, 'failed'],
        ])
        .toArray();
      // `userId` ausente = op encolada antes de la v12 del esquema; no se le
      // puede atribuir un autor, así que no la contamos como ajena.
      return rows.filter((op) => op.userId != null && op.userId !== userId)
        .length;
    }, [tenantId, userId]) ?? 0;

  const triggerSync = useCallback(
    async (options?: { ignoreBackoff?: boolean }) => {
      if (!tenantId || !accessToken || syncInFlightRef.current) return;

      syncInFlightRef.current = true;
      setIsSyncing(true);
      setSyncError(null);

      try {
        // Pedimos la sesión en vez de usar `accessToken` de las props, que es la
        // foto del último render y durante un corte queda vencida.
        //
        // Esto arregla la carrera que enterraba la cola: el evento `online`
        // dispara este sync al instante, pero el ticker de supabase-js recién
        // refresca a los 30 s. El push salía con el token muerto, cosechaba 401
        // en cada op y las mandaba a `failed`. `getSession()` fuerza el refresh
        // acá mismo y el push arranca con un token válido.
        const { data } = await supabase.auth.getSession();
        const freshToken = data.session?.access_token;

        if (!freshToken) {
          // El refresh no anda: sin red no hay nada que hacer (los cambios ya
          // están a salvo en Dexie), y si el refresh token murió hace falta
          // volver a iniciar sesión. En ningún caso tocamos la cola.
          setSyncError(
            'No pudimos validar la sesión. Los cambios quedan guardados en este equipo.',
          );
          return;
        }

        syncService.setCredentials(tenantId, freshToken);
        await syncService.fullSync(options?.ignoreBackoff ?? false);
        setLastSyncAt(new Date());
      } catch (error) {
        const message = translateApiError(error);
        setSyncError(message);
        showToast({
          message: `Error al sincronizar: ${message}`,
          kind: 'error',
        });
      } finally {
        setIsSyncing(false);
        syncInFlightRef.current = false;
      }
    },
    [tenantId, accessToken, showToast],
  );

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
      value={{
        pendingCount,
        blockedCount,
        otherOperatorCount,
        isSyncing,
        lastSyncAt,
        syncError,
        triggerSync,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
