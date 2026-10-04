import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { refreshReservations } from '../../lib/sync/reservationsSnapshot';
import {
  newPendingIds,
  newPendingMessage,
  pendingCount,
  pendingIdSet,
} from './reservationBoard';

/**
 * Cada cuánto se relee con conexión. Igual que la pantalla del dueño en la
 * web: el plazo para responder es de 15 minutos, así que en el peor caso el
 * operador se entera con 14:45 por delante.
 *
 * TODO(notificaciones): ver docs/handoff/notificaciones-push.md — con push o
 * realtime esto deja de ser polling.
 */
export const RESERVATIONS_POLL_MS = 15_000;

/** Cada cuánto se recalcula el badge sin conexión (las vencidas dejan de contar). */
const BADGE_TICK_MS = 15_000;

const BASE_TITLE = 'Parkit';

export interface ReservationsFeed {
  /** Por aceptar y todavía a tiempo: el badge del menú. */
  pendingCount: number;
  /** Cambia cada vez que llega una reserva nueva por aceptar (anima el badge). */
  pulseKey: number;
  /** Relee ya (después de aceptar o rechazar, o con el botón Actualizar). */
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** La última lectura falló (con conexión). La foto puede estar vieja. */
  failed: boolean;
}

/**
 * Mantiene al día la foto local de reservas de la playa y avisa cuando entra
 * una nueva por aceptar. Vive en `SessionView` y no en la sección Reservas: el
 * aviso y el badge tienen que funcionar desde cualquier pantalla de la caja.
 *
 * Con conexión relee cada 15 s, al volver el foco a la ventana y cada vez que
 * entra o sale un auto (un ingreso vinculado pasa la reserva a "En curso").
 * Sin conexión no hace nada: la caja muestra la última foto, sólo lectura.
 */
export function useReservationsFeed(input: {
  tenantId: string | null;
  accessToken: string;
}): ReservationsFeed {
  const { tenantId, accessToken } = input;
  const { isOnline } = useNetwork();
  const { showToast } = useToast();
  const [pulseKey, setPulseKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  // Ids por aceptar que la caja ya conoce, por playa. `null` = todavía
  // no se leyó nada en esta sesión (se arranca de la foto guardada); `ids =
  // null`, no había foto: todas las por aceptar cuentan como nuevas.
  const knownRef = useRef<{ tenantId: string; ids: Set<string> | null } | null>(
    null,
  );
  const inFlightRef = useRef<Promise<void> | null>(null);
  const againRef = useRef(false);

  const runOnce = useCallback(async () => {
    if (!tenantId) return;
    if (knownRef.current?.tenantId !== tenantId) {
      const saved = await localDb.reservations
        .where('tenantId')
        .equals(tenantId)
        .toArray();
      knownRef.current = {
        tenantId,
        ids: saved.length > 0 ? pendingIdSet(saved) : null,
      };
    }
    const rows = await refreshReservations({ tenantId, bearer: accessToken });
    // Si cambió de playa mientras tanto, el aviso no es de esta.
    if (knownRef.current.tenantId !== tenantId) return;
    const fresh = newPendingIds(knownRef.current.ids, rows);
    knownRef.current.ids = pendingIdSet(rows);
    if (fresh.length > 0) {
      const freshRows = rows.filter((r) => fresh.includes(r.id));
      showToast({ message: newPendingMessage(freshRows), kind: 'info' });
      setPulseKey((k) => k + 1);
    }
  }, [tenantId, accessToken, showToast]);

  const refresh = useCallback(async () => {
    if (!tenantId || !isOnline) return;
    // Una sola lectura a la vez; si piden otra en el medio, se hace al final.
    if (inFlightRef.current) {
      againRef.current = true;
      return inFlightRef.current;
    }
    setRefreshing(true);
    const run = (async () => {
      try {
        do {
          againRef.current = false;
          try {
            await runOnce();
            setFailed(false);
          } catch {
            // La lista es una ayuda: un fallo no interrumpe la caja. Se marca
            // y la próxima vuelta reintenta.
            setFailed(true);
          }
        } while (againRef.current);
      } finally {
        inFlightRef.current = null;
        setRefreshing(false);
      }
    })();
    inFlightRef.current = run;
    return run;
  }, [tenantId, isOnline, runOnce]);

  // Cambia con cada ingreso y egreso: dispara la relectura.
  const openEntries = useLiveQuery(
    () =>
      tenantId
        ? localDb.entries
            .where('tenantId')
            .equals(tenantId)
            .filter((e) => !e.leftAt)
            .count()
        : 0,
    [tenantId],
  );

  useEffect(() => {
    if (!tenantId || !isOnline) return;
    void refresh();
    const timer = window.setInterval(
      () => void refresh(),
      RESERVATIONS_POLL_MS,
    );
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tenantId, isOnline, refresh, openEntries]);

  const rows = useLiveQuery(
    () =>
      tenantId
        ? localDb.reservations.where('tenantId').equals(tenantId).toArray()
        : [],
    [tenantId],
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), BADGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  const count = useMemo(() => pendingCount(rows ?? [], now), [rows, now]);

  // El título de la ventana lleva la cuenta: se ve en la barra de tareas aunque
  // la caja esté minimizada o detrás de otra ventana.
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, [count]);
  useEffect(
    () => () => {
      document.title = BASE_TITLE;
    },
    [],
  );

  return { pendingCount: count, pulseKey, refresh, refreshing, failed };
}
