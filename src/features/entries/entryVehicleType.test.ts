import { describe, expect, it } from 'vitest';
import type { LocalVehicleType } from '../../lib/db/localDb';
import {
  buildVehicleTypeSnapshot,
  isTypeNotAccepted,
  isTypeRequired,
  sortSelectableTypes,
  typeIdForCatalogSelection,
} from './entryVehicleType';

function type(
  id: string,
  name: string,
  overrides: Partial<LocalVehicleType> = {},
): LocalVehicleType {
  return {
    id,
    tenantId: 't',
    name,
    accepted: true,
    category: 'car',
    version: 1,
    syncSeq: 1,
    updatedAt: '',
    createdAt: '',
    ...overrides,
  };
}

const catalog = [
  { brand: 'Toyota', model: 'Corolla', typeId: 'auto' },
  { brand: 'Toyota', model: 'Hilux', typeId: 'pick' },
  { brand: 'Renault', model: 'Kangoo', typeId: 'util' },
  { brand: 'Renault', model: 'Kwid', typeId: 'util' },
];

describe('typeIdForCatalogSelection', () => {
  it('toma el tipo de la fila exacta, sin distinguir mayúsculas', () => {
    expect(typeIdForCatalogSelection(catalog, 'toyota', 'COROLLA')).toBe(
      'auto',
    );
  });
  it('con sólo marca devuelve el tipo si es único', () => {
    expect(typeIdForCatalogSelection(catalog, 'Renault', '')).toBe('util');
  });
  it('con sólo marca y tipos mezclados no adivina', () => {
    expect(typeIdForCatalogSelection(catalog, 'Toyota', '')).toBeUndefined();
  });
  it('sin coincidencia devuelve undefined', () => {
    expect(typeIdForCatalogSelection(catalog, 'Honda', 'CB')).toBeUndefined();
  });
});

describe('sortSelectableTypes', () => {
  it('descarta borrados y pone primero los aceptados', () => {
    const sorted = sortSelectableTypes([
      type('1', 'Zeta'),
      type('2', 'Alfa', { accepted: false }),
      type('3', 'Beta'),
      type('4', 'Borrado', { deletedAt: '2026-01-01' }),
    ]);
    expect(sorted.map((t) => t.name)).toEqual(['Beta', 'Zeta', 'Alfa']);
  });
});

describe('buildVehicleTypeSnapshot', () => {
  const types = [type('m', 'Moto', { category: 'motorcycle' })];
  it('devuelve id, categoría y nombre del tipo', () => {
    expect(buildVehicleTypeSnapshot('m', types)).toEqual({
      vehicleTypeId: 'm',
      vehicleCategory: 'motorcycle',
      vehicleType: 'Moto',
    });
  });
  it('sin tipo o con un tipo desconocido no manda nada', () => {
    expect(buildVehicleTypeSnapshot(undefined, types)).toEqual({});
    expect(buildVehicleTypeSnapshot('x', types)).toEqual({});
  });
  it('un tipo viejo sin categoría manda id y nombre, no categoría', () => {
    const legacy = [type('l', 'Viejo', { category: undefined })];
    expect(buildVehicleTypeSnapshot('l', legacy)).toEqual({
      vehicleTypeId: 'l',
      vehicleCategory: undefined,
      vehicleType: 'Viejo',
    });
  });
});

describe('isTypeRequired', () => {
  it('es obligatorio sólo con texto libre', () => {
    expect(isTypeRequired(false)).toBe(true);
    expect(isTypeRequired(true)).toBe(false);
  });
});

describe('isTypeNotAccepted', () => {
  const types = [type('ok', 'Auto'), type('no', 'Camión', { accepted: false })];
  it('avisa sólo si el tipo existe y no se acepta', () => {
    expect(isTypeNotAccepted('no', types)).toBe(true);
    expect(isTypeNotAccepted('ok', types)).toBe(false);
    expect(isTypeNotAccepted('zzz', types)).toBe(false);
    expect(isTypeNotAccepted(undefined, types)).toBe(false);
  });
});
