import { describe, expect, it } from 'vitest';
import { matchesDateFilter, normalizeDateFilter } from './dateFilter';

const from = new Date(2026, 10, 2);
const to = new Date(2026, 10, 4);

describe('fecha y presencia de egreso', () => {
  it.each([undefined, null, ''])(
    'Todos conserva filas sin egreso: %s',
    (value) => {
      expect(matchesDateFilter(value, undefined, true)).toBe(true);
      expect(matchesDateFilter(value, { presence: 'missing' }, true)).toBe(
        true,
      );
      expect(matchesDateFilter(value, { presence: 'present' }, true)).toBe(
        false,
      );
    },
  );

  it('distingue los estados y permite acotar egresados por fecha', () => {
    expect(matchesDateFilter('2026-11-02', undefined, true)).toBe(true);
    expect(matchesDateFilter('2026-11-02', { presence: 'present' }, true)).toBe(
      true,
    );
    expect(matchesDateFilter('2026-11-02', { presence: 'missing' }, true)).toBe(
      false,
    );
    expect(
      matchesDateFilter('2026-11-03', { presence: 'present', from, to }, true),
    ).toBe(true);
    expect(
      matchesDateFilter('2026-11-05', { presence: 'present', from, to }, true),
    ).toBe(false);
    expect(matchesDateFilter('', { from, to }, true)).toBe(false);
  });

  it('limpia el rango incompatible al elegir En base y sobrevive a JSON', () => {
    expect(
      normalizeDateFilter({ presence: 'missing', from, to }, true),
    ).toEqual({ from: undefined, presence: 'missing' });
    expect(
      normalizeDateFilter(
        JSON.parse(JSON.stringify({ presence: 'present', from, to })),
        true,
      ),
    ).toEqual({ presence: 'present', from, to });
    expect(normalizeDateFilter({ presence: 'missing' }, true)).toEqual({
      from: undefined,
      presence: 'missing',
    });
  });

  it('conserva rangos anteriores y no agrega presencia a otras columnas', () => {
    expect(
      normalizeDateFilter({ from: from.toISOString(), to: to.toISOString() }),
    ).toEqual({ from, to });
    expect(normalizeDateFilter({ presence: 'missing' })).toBeUndefined();
    expect(matchesDateFilter('2026-11-02', { presence: 'missing' })).toBe(true);
    expect(
      matchesDateFilter('2026-11-02', { presence: 'missing', from, to }),
    ).toBe(true);
    expect(
      matchesDateFilter('2026-11-05', { presence: 'missing', from, to }),
    ).toBe(false);
  });

  it('descarta valores inválidos y conserva un estado válido sin fechas', () => {
    expect(normalizeDateFilter({ from: 'invalid' })).toBeUndefined();
    expect(normalizeDateFilter([])).toBeUndefined();
    expect(
      normalizeDateFilter({ presence: 'present', from: 'invalid' }, true),
    ).toEqual({ from: undefined, presence: 'present' });
    expect(
      normalizeDateFilter({ from, to: 'invalid', presence: 'unknown' }, true),
    ).toEqual({ from });
  });
});
