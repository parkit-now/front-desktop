import { useLiveQuery } from 'dexie-react-hooks';
import {
  localDb,
  type LocalVehicleCategory,
  type VehicleCategoryCode,
} from '../../lib/db/localDb';

/** Las categorías de la plataforma ordenadas como las manda el servidor. */
export function sortCategories(
  categories: readonly LocalVehicleCategory[],
): LocalVehicleCategory[] {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Etiqueta para mostrar. Una categoría que la lista local no conoce (la caja
 * todavía no bajó la lista, o el servidor agregó una) se muestra con su código
 * antes que inventar un nombre; sin categoría, un guion.
 */
export function categoryLabel(
  code: VehicleCategoryCode | undefined | null,
  categories: readonly LocalVehicleCategory[],
): string {
  if (!code) return '—';
  return categories.find((c) => c.code === code)?.label ?? code;
}

/** Hook: lista local de categorías (vacía hasta el primer sync). */
export function useVehicleCategories(): LocalVehicleCategory[] {
  const rows = useLiveQuery(() => localDb.vehicleCategories.toArray(), []);
  return sortCategories(rows ?? []);
}
