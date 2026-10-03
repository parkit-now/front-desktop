import { describe, expect, it } from 'vitest';
import type { LocalVehicleCategory } from '../../lib/db/localDb';
import { categoryLabel, sortCategories } from './vehicleCategories';

const cats: LocalVehicleCategory[] = [
  { code: 'motorcycle', label: 'Moto', sortOrder: 5, reservable: true },
  { code: 'car', label: 'Auto', sortOrder: 1, reservable: true },
];

describe('sortCategories', () => {
  it('ordena por sortOrder sin mutar la entrada', () => {
    expect(sortCategories(cats).map((c) => c.code)).toEqual([
      'car',
      'motorcycle',
    ]);
    expect(cats[0].code).toBe('motorcycle');
  });
});

describe('categoryLabel', () => {
  it('devuelve la etiqueta de la lista', () => {
    expect(categoryLabel('car', cats)).toBe('Auto');
  });
  it('cae al código si la lista no la conoce', () => {
    expect(categoryLabel('truck', cats)).toBe('truck');
  });
  it('muestra un guion si no hay categoría', () => {
    expect(categoryLabel(undefined, cats)).toBe('—');
    expect(categoryLabel(null, cats)).toBe('—');
  });
});
