import type {
  LocalVehicleType,
  VehicleCategoryCode,
} from '../../lib/db/localDb';

/**
 * Lógica pura del tipo de vehículo del formulario de ingreso. Vive acá y no
 * en `EntryFormCore` para poder testearla sin montar React ni Dexie.
 */

type CatalogRow = { brand: string; model: string; typeId: string };

/**
 * Tipo que arrastra la selección del catálogo.
 *
 * - Con modelo: el de la fila exacta (marca y modelo, sin distinguir mayúsculas).
 * - Sólo marca: el tipo común a TODOS sus modelos, si es uno solo. Si la marca
 *   mezcla tipos (p. ej. Toyota: auto, SUV y pickup) no se adivina: queda para
 *   que lo elija el operador.
 */
export function typeIdForCatalogSelection(
  catalog: readonly CatalogRow[],
  brand: string,
  model: string,
): string | undefined {
  const b = brand.trim().toLowerCase();
  const m = model.trim().toLowerCase();
  if (!b) return undefined;

  if (m) {
    return catalog.find(
      (v) => v.brand.toLowerCase() === b && v.model.toLowerCase() === m,
    )?.typeId;
  }

  const typeIds = new Set(
    catalog.filter((v) => v.brand.toLowerCase() === b).map((v) => v.typeId),
  );
  return typeIds.size === 1 ? [...typeIds][0] : undefined;
}

/** Tipos vivos del tenant, los aceptados en caja primero y luego por nombre. */
export function sortSelectableTypes(
  types: readonly LocalVehicleType[],
): LocalVehicleType[] {
  return types
    .filter((t) => !t.deletedAt)
    .sort(
      (a, b) =>
        Number(b.accepted) - Number(a.accepted) ||
        a.name.localeCompare(b.name, 'es'),
    );
}

export type VehicleTypeSnapshot = {
  vehicleTypeId?: string;
  vehicleCategory?: VehicleCategoryCode;
  vehicleType?: string;
};

/**
 * Los tres campos que el ingreso congela. Un `typeId` que no está en la lista
 * (tipo borrado, catálogo desfasado) no manda nada: el servidor se queda sin
 * tipo antes que con un id al que no puede darle nombre ni categoría.
 */
export function buildVehicleTypeSnapshot(
  typeId: string | undefined,
  types: readonly LocalVehicleType[],
): VehicleTypeSnapshot {
  if (!typeId) return {};
  const type = types.find((t) => t.id === typeId && !t.deletedAt);
  if (!type) return {};
  return {
    vehicleTypeId: type.id,
    vehicleCategory: type.category,
    vehicleType: type.name,
  };
}

/**
 * El Tipo es obligatorio cuando la marca/modelo es texto libre (no salió del
 * catálogo), porque ahí no hay nada de dónde sacarlo.
 */
export function isTypeRequired(vehicleSelected: boolean): boolean {
  return !vehicleSelected;
}

/** Aviso (no bloqueante) si el tipo elegido no se acepta en caja. */
export function isTypeNotAccepted(
  typeId: string | undefined,
  types: readonly LocalVehicleType[],
): boolean {
  if (!typeId) return false;
  const type = types.find((t) => t.id === typeId && !t.deletedAt);
  return type !== undefined && !type.accepted;
}
