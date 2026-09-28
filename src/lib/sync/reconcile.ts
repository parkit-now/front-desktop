/**
 * Poda de filas locales que el servidor ya no conoce.
 *
 * EL AGUJERO QUE CIERRA
 *
 * El pull incremental sólo agrega y actualiza: ante una fila que el servidor no
 * menciona, no tiene opinión. Las bajas viajan como tombstones, pero eso exige
 * que la fila siga existiendo allá con su `deletedAt`. Si una fila desaparece
 * de verdad —un borrado físico, un restore de backup, una migración— el feed no
 * la va a mencionar nunca más y la copia local queda para siempre.
 *
 * Pasó: entre las migraciones `20260603223052` y `20260831172808` las tarifas
 * se borraban físicamente. Esas instalaciones no tenían forma de curarse, y la
 * única salida era borrar `%appdata%` entero — que se lleva puestas también las
 * operaciones sin sincronizar, la configuración de cámara y las imágenes.
 *
 * Esto es la red: comparar contra la lista autoritativa y podar lo que sobra.
 *
 * TODAS LAS DECISIONES VIVEN ACÁ, EN FUNCIONES PURAS
 *
 * Borrar datos del operador es lo más peligroso que hace el sync, así que la
 * decisión de qué se borra se toma en funciones sin I/O, testeables una por
 * una. El servicio sólo junta los datos y aplica el veredicto.
 */

/** Cada cuánto vale la pena reconciliar, por entidad. */
export const RECONCILE_INTERVAL_MS = {
  /** Catálogos chicos: el listado entero pesa menos que 5 KB. */
  small: 6 * 60 * 60 * 1000,
  /** El catálogo de modelos son ~1200 filas: más espaciado. */
  large: 24 * 60 * 60 * 1000,
} as const;

/**
 * No se borra nada si la poda se pasa de este porcentaje del total local...
 *
 * Es la segunda red contra un filtro mal puesto del lado del servidor. El caso
 * concreto que la motiva: `listRates` filtra `isActive: true` salvo que se le
 * mande `includeInactive`, así que pedirlo mal borraría todas las tarifas
 * desactivadas pero vivas. El primer freno es acordarse del flag; éste es para
 * cuando alguien se lo olvide.
 */
export const PRUNE_MAX_RATIO = 0.5;

/**
 * ...pero sólo a partir de este mínimo absoluto.
 *
 * Sin el piso, el porcentaje haría inútil la reconciliación justo donde más
 * sirve: en un catálogo de 2 filas, borrar 1 es el 50 % y sería legítimo.
 */
export const PRUNE_MIN_ABSOLUTE = 3;

/** Clave del sello en `syncState`. */
export function reconcileStateKey(entity: string, tenantId: string): string {
  // El prefijo va ADELANTE a propósito. Los upgrades del esquema local borran
  // cursores con `key.startsWith('<entidad>:')` para forzar un re-pull; si esto
  // fuera `rates:<tenant>:reconcile`, el próximo reset de cursor se lo llevaría
  // puesto y la reconciliación volvería a correr de cero sin motivo.
  return `reconcile:${entity}:${tenantId}`;
}

export function shouldReconcile(input: {
  lastRunAt: string | undefined;
  intervalMs: number;
  now: number;
  force: boolean;
}): boolean {
  // El botón manual no espera: es la salida que tiene el operador cuando ve
  // algo que no debería estar ahí.
  if (input.force) return true;
  if (!input.lastRunAt) return true;
  const last = new Date(input.lastRunAt).getTime();
  if (!Number.isFinite(last)) return true;
  return input.now - last >= input.intervalMs;
}

export type PruneDecision =
  | { prune: string[]; seal: true }
  | { prune: []; seal: boolean; skip: PruneSkipReason };

export type PruneSkipReason =
  | 'incomplete'
  | 'empty-server'
  | 'too-many'
  | 'nothing-to-prune';

/**
 * Qué ids hay que borrar, si es que hay que borrar alguno.
 *
 * FAIL CLOSED: ante cualquier duda no se borra nada. Un fantasma de más cuesta
 * una fila en una lista; un borrado de más le puede dejar al operador un
 * estacionamiento sin tarifas para cobrar en plena jornada.
 *
 * `seal` dice si corresponde sellar la marca de tiempo. Un problema transitorio
 * NO sella, para que el próximo ciclo reintente; uno que no se va a arreglar
 * solo sí sella, para no machacar al servidor cada 90 segundos.
 */
export function decidePrune(input: {
  localIds: string[];
  serverIds: string[];
  dirtyIds: ReadonlySet<string>;
  serverComplete: boolean;
}): PruneDecision {
  // La lista llegó cortada: lo que falta puede ser una fila viva.
  if (!input.serverComplete) {
    return { prune: [], seal: false, skip: 'incomplete' };
  }

  // Servidor vacío con filas locales. Un tenant legítimamente vacío y un bug
  // que devuelve `[]` son indistinguibles desde acá, y el costo de equivocarse
  // es dejar al operador sin poder cobrar. Se sella igual porque reintentar no
  // va a cambiar la respuesta.
  if (input.serverIds.length === 0 && input.localIds.length > 0) {
    return { prune: [], seal: true, skip: 'empty-server' };
  }

  const server = new Set(input.serverIds);
  const prune = input.localIds.filter(
    // Una fila con una operación encolada encima NO se toca, aunque el servidor
    // no la conozca: lo más probable es que sea un alta local que todavía no se
    // pusheó. Incluye las ops trabadas en `conflict` y `failed`, que es el lado
    // seguro: protegen su fila hasta que una persona las resuelva.
    (id) => !server.has(id) && !input.dirtyIds.has(id),
  );

  if (prune.length === 0) {
    return { prune: [], seal: true, skip: 'nothing-to-prune' };
  }

  if (
    prune.length > PRUNE_MIN_ABSOLUTE &&
    prune.length > input.localIds.length * PRUNE_MAX_RATIO
  ) {
    return { prune: [], seal: true, skip: 'too-many' };
  }

  return { prune, seal: true };
}
