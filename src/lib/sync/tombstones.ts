/**
 * Separa los tombstones de las filas vivas en una página del feed de sync.
 *
 * Esta lógica estaba duplicada, literal, en las siete funciones `pull*` de
 * `SyncService`. Es la que ya tuvo que reparar dos commits distintos —el de
 * tasas (`0a7d88c`) y el de vehículos— y no tenía test en ninguna de sus siete
 * copias: una baja que no se procesa deja la fila para siempre en el IndexedDB
 * del operador, y eso es invisible hasta que alguien reporta "me sigue
 * apareciendo un vehículo que borré".
 *
 * `deletedAt != null` cubre `null` y `undefined` a propósito: el backend manda
 * `null` y el mapper local lo convierte en `undefined`.
 */
export function splitTombstones<T extends { deletedAt?: string | null }>(
  items: T[],
): { active: T[]; deleted: T[] } {
  const active: T[] = [];
  const deleted: T[] = [];
  for (const item of items) {
    if (item.deletedAt != null) deleted.push(item);
    else active.push(item);
  }
  return { active, deleted };
}
