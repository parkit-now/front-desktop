import { ApiError } from '../api/client';

/**
 * El estacionamiento de esta sesión fue dado de baja desde el panel.
 *
 * EL PROBLEMA QUE RESUELVE
 *
 * Sin esto, el equipo de la playa se queda abierto mostrando datos de Dexie de
 * un estacionamiento que ya no existe, y el operador sigue cobrando autos
 * contra una caja que el servidor rechaza con 410 en cada request.
 *
 * `SessionView` ya reaccionaba a que la sucursal activa desapareciera de las
 * membresías, pero ese efecto arranca con `if (memberships.length === 0)
 * return;`. O sea que si era la ÚNICA sucursal —el caso de una playa sola— se
 * iba por la primera línea y no pasaba nada. Con dos sucursales se arreglaba
 * solo; con una, no.
 *
 * CÓMO SE ENTERA, SIN POLLING NUEVO
 *
 * El pull de fondo de `SyncContext` ya pega contra `/tenants/:tenantId/...`
 * cada 90 s, y al reconectar `triggerSync` dispara al instante. Esas requests
 * pasan por el guard del backend, así que el 410 llega solo. Sin red no pasa
 * nada y la sesión offline se respeta, que es justamente lo que tiene que
 * pasar: un corte de internet no es una baja.
 *
 * LO QUE NO HACE: BORRAR DEXIE
 *
 * La baja es reversible hasta la purga. Si el desktop se limpiara solo al
 * recibir el 410 y después el admin restaura el estacionamiento, el trabajo
 * sin sincronizar de ese operador se habría perdido para siempre. Se cierra la
 * sesión; los datos quedan.
 */
const TENANT_DELETED_CODE = 'ENTITY_DELETED';

type Listener = (tenantId: string) => void;

const listeners = new Set<Listener>();

/** Si este error es el 410 de un estacionamiento dado de baja. */
export function isTenantDeletedError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 410) return false;
  // El `code` es el contrato estable; el status solo no alcanza porque 410
  // podría usarse para otra cosa más adelante.
  return error.problem?.code === TENANT_DELETED_CODE;
}

/**
 * Avisa que el tenant fue dado de baja. Lo llama `apiRequest`, el único punto
 * por el que pasan todas las llamadas.
 */
export function notifyTenantDeleted(tenantId: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(tenantId);
    } catch (error) {
      // Un listener roto no puede impedir que se enteren los demás.
      console.error('[tenant-deleted] listener falló', error);
    }
  }
}

/** Se suscribe. Devuelve la función para darse de baja. */
export function onTenantDeleted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Saca el tenantId del path de la request, que es donde vive. */
export function tenantIdFromPath(path: string): string | null {
  const match = /^\/tenants\/([^/?]+)/.exec(path);
  return match ? match[1] : null;
}

/**
 * El texto que ve el operador en la pantalla de login después de que se le
 * cierre la sesión por esto.
 *
 * No dice "error": no lo es, y el operador no hizo nada mal. Dice qué pasó y
 * qué hacer, que es lo único accionable desde una playa a las 3 de la mañana.
 */
export const TENANT_DELETED_NOTICE =
  'El estacionamiento de esta computadora fue eliminado desde el panel de administración. ' +
  'Si creés que es un error, hablá con el administrador antes de volver a iniciar sesión.';

/**
 * Aviso de un solo uso para la pantalla de login.
 *
 * Existe porque la decisión y el mensaje viven en lugares distintos:
 * `SessionView` es quien sabe si quedan otras sucursales (y por lo tanto si
 * hay que cerrar la sesión o sólo cambiar de sucursal), pero la pantalla de
 * login la renderiza `App`. En vez de hacer que `App` repita esa decisión,
 * `SessionView` deja el aviso acá al cerrar sesión y `App` lo levanta cuando
 * se queda sin sesión.
 *
 * Se consume al leerlo: si quedara, aparecería en el próximo logout manual,
 * que no tiene nada que ver.
 */
let pendingNotice: string | null = null;

export function setPendingAuthNotice(notice: string): void {
  pendingNotice = notice;
}

export function takePendingAuthNotice(): string | null {
  const notice = pendingNotice;
  pendingNotice = null;
  return notice;
}
