import { describe, expect, it } from 'vitest';
import {
  caseInsensitiveSort,
  dedupeIds,
  getPaginationPageCount,
  getPaginationSummary,
  getVisiblePageNumbers,
  inNumberRange,
  normalizeNumberRange,
  normalizeText,
  textSorting,
} from './utils';

describe('data-table utils', () => {
  it('normalizes text for accent-insensitive search', () => {
    expect(normalizeText('  Estadía Ñandú  ')).toBe('estadia nandu');
  });

  it('dedupes ids preserving order', () => {
    expect(dedupeIds(['name', 'status', 'name', 'updatedAt'])).toEqual([
      'name',
      'status',
      'updatedAt',
    ]);
  });

  it('calculates page count and summary', () => {
    expect(getPaginationPageCount(101, 10)).toBe(11);
    expect(
      getPaginationSummary({ pageIndex: 2, pageSize: 10, totalRows: 27 }),
    ).toEqual({ from: 21, to: 27, totalRows: 27 });
  });

  it('returns visible page numbers with ellipses', () => {
    expect(getVisiblePageNumbers(5, 12)).toEqual([
      1,
      'start-ellipsis',
      4,
      5,
      6,
      7,
      8,
      'end-ellipsis',
      12,
    ]);
  });

  describe('caseInsensitiveSort', () => {
    // El comparador recibe filas de tanstack; alcanza con getValue.
    const sort = (a: unknown, b: unknown) =>
      caseInsensitiveSort(
        { getValue: () => a } as never,
        { getValue: () => b } as never,
        'col',
      );
    const sortText = (a: unknown, b: unknown) =>
      textSorting()(
        { getValue: () => a } as never,
        { getValue: () => b } as never,
        'col',
      );

    it('ordena numeros por valor y no como texto', () => {
      expect(sort(2, 10)).toBeLessThan(0);
      expect(sort(100, 20)).toBeGreaterThan(0);
      expect(sort(3, 3)).toBe(0);
      // El caso que delataba el bug: [1, 2, 10, 100] no debe quedar 1,10,100,2
      expect([100, 2, 10, 1].sort(sort)).toEqual([1, 2, 10, 100]);
    });

    it('ordena decimales correctamente', () => {
      expect([9500.5, 300, 4200.75, 8000].sort(sort)).toEqual([
        300, 4200.75, 8000, 9500.5,
      ]);
    });

    it('sigue ordenando texto sin acentos ni mayusculas', () => {
      expect(['Ñandu', 'estadia', 'Álamo'].sort(sort)).toEqual([
        'Álamo',
        'estadia',
        'Ñandu',
      ]);
    });

    it('ordena por valor los numeros guardados como texto', () => {
      // Los precios de las tarifas viajan como `string` desde Dexie y el
      // accessor los entrega sin convertir. Como texto, '900' iba al final.
      expect(['1500', '900', '10000', '2000'].sort(sort)).toEqual([
        '900',
        '1500',
        '2000',
        '10000',
      ]);
    });

    it('las patentes NO usan ese criterio: van por texto', () => {
      // Una patente es un codigo, no una cantidad: se lee como cadena, igual
      // que en el papel. Por eso las columnas de patente llevan `textSorting`.
      expect(['AA10', 'AA2', 'AB1'].sort(sortText)).toEqual([
        'AA10',
        'AA2',
        'AB1',
      ]);
    });

    it('ordena fechas por instante', () => {
      const antes = new Date('2026-01-01T00:00:00Z');
      const despues = new Date('2026-08-28T00:00:00Z');
      expect(sort(antes, despues)).toBeLessThan(0);
    });

    it('agrupa los vacios de un solo lado, sin romper la transitividad', () => {
      expect(sort(null, 5)).toBeLessThan(0);
      expect(sort(5, null)).toBeGreaterThan(0);
      expect(sort(null, undefined)).toBe(0);
      expect(sort('', 5)).toBeLessThan(0);
      // Sin `undefined` en el array: Array.sort lo manda al final por su cuenta,
      // sin pasarlo por el comparador.
      expect([10, null, 2, 1].sort(sort)).toEqual([null, 1, 2, 10]);
    });
  });
});

describe('rango numérico', () => {
  it('extremos inclusivos; sin número no pasa si hay rango', () => {
    expect(inNumberRange(1000, { min: 1000, max: 2000 })).toBe(true);
    expect(inNumberRange(2500, { max: 2000 })).toBe(false);
    expect(inNumberRange(undefined, { min: 1 })).toBe(false);
    expect(inNumberRange(undefined, undefined)).toBe(true);
  });

  it('normaliza lo persistido: descarta lo que no es un número', () => {
    expect(normalizeNumberRange({ min: 10, max: 'x' })).toEqual({
      min: 10,
      max: undefined,
    });
    expect(normalizeNumberRange({})).toBeUndefined();
    expect(normalizeNumberRange(['a'])).toBeUndefined();
  });
});
