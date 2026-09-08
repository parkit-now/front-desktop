import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { readBaseUrl } from '../api/client';

interface NetworkContextValue {
  /**
   * Si se puede operar contra el servidor. Es lo que mira el patrón
   * `if (isOnline) { API } else { encolar }`.
   */
  isOnline: boolean;
  /** Hay una interfaz de red levantada (`navigator.onLine`). */
  networkUp: boolean;
  /** El backend contestó el último health-check. */
  backendReachable: boolean;
}

const NetworkContext = createContext<NetworkContextValue>({
  isOnline: true,
  networkUp: true,
  backendReachable: true,
});

/** Cada cuánto se revalida cuando el backend viene contestando. */
const HEALTHY_POLL_MS = 30_000;
/** Más seguido cuando no contesta, para detectar la vuelta rápido. */
const UNHEALTHY_POLL_MS = 10_000;
/** En Wi-Fi malo un fetch puede quedar colgado; sin esto el probe nunca cierra. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * Detección de conectividad para la app de playa.
 *
 * `navigator.onLine` sola no alcanza: en Chromium solo dice si hay una interfaz
 * de red levantada, no si el backend contesta. Con el router prendido y sin
 * internet — el escenario típico de un estacionamiento con Wi-Fi flojo —
 * devuelve `true`, las escrituras toman la rama online, fallan, y NO se
 * encolan. El operador pierde la operación sin enterarse.
 *
 * Por eso el estado real se compone: interfaz levantada Y backend respondiendo
 * su `/health`.
 */
export function NetworkProvider({ children }: { children: React.ReactNode }) {
  const [networkUp, setNetworkUp] = useState(navigator.onLine);
  // Optimista: el primer probe sale en el mount y corrige en milisegundos.
  // Arrancar en `false` frenaría el sync inicial de un equipo que está bien.
  const [backendReachable, setBackendReachable] = useState(true);

  const probe = useCallback(async (): Promise<boolean> => {
    // Sin interfaz de red no hace falta gastar el probe.
    if (!navigator.onLine) {
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, PROBE_TIMEOUT_MS);

    try {
      const response = await fetch(`${readBaseUrl()}/health`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      // `/health` devuelve 503 si la DB está caída: el backend está vivo pero
      // no puede atender, que para el operador es lo mismo que estar offline.
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  // Timeout recursivo y no `setInterval`: la cadencia depende del resultado
  // anterior, y así no se apilan probes si uno tarda.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(): Promise<void> {
      const ok = await probe();
      if (cancelled) {
        return;
      }

      setBackendReachable(ok);
      timer = setTimeout(
        () => {
          void tick();
        },
        ok ? HEALTHY_POLL_MS : UNHEALTHY_POLL_MS,
      );
    }

    void tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [probe]);

  useEffect(() => {
    const handleOnline = () => {
      setNetworkUp(true);
      // El SO dice que volvió la red: confirmamos contra el backend ya mismo
      // en vez de esperar el próximo tick.
      void probe().then((ok) => {
        setBackendReachable(ok);
      });
    };
    const handleOffline = () => {
      setNetworkUp(false);
      setBackendReachable(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [probe]);

  const isOnline = networkUp && backendReachable;

  return (
    <NetworkContext.Provider value={{ isOnline, networkUp, backendReachable }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  return useContext(NetworkContext);
}
