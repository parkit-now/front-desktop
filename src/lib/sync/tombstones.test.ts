import { describe, expect, it } from 'vitest';
import { splitTombstones } from './tombstones';

type Row = { id: string; deletedAt?: string | null };

const alive: Row = { id: 'a', deletedAt: null };
const gone: Row = { id: 'b', deletedAt: '2026-09-01T00:00:00.000Z' };

describe('splitTombstones', () => {
  it('separa vivos de borrados', () => {
    const { active, deleted } = splitTombstones([alive, gone]);
    expect(active.map((i) => i.id)).toEqual(['a']);
    expect(deleted.map((i) => i.id)).toEqual(['b']);
  });

  it('trata `undefined` como vivo, igual que `null`', () => {
    // El backend manda `null`; el mapper local lo convierte en `undefined`.
    // Si el chequeo fuera `!== null` estricto, una fila viva mapeada se
    // borraría del IndexedDB del operador.
    const { active, deleted } = splitTombstones<Row>([{ id: 'c' }]);
    expect(active.map((i) => i.id)).toEqual(['c']);
    expect(deleted).toEqual([]);
  });

  it('una página sin bajas no produce borrados', () => {
    const { active, deleted } = splitTombstones<Row>([alive, { id: 'd' }]);
    expect(active).toHaveLength(2);
    expect(deleted).toEqual([]);
  });

  it('una página vacía no rompe', () => {
    expect(splitTombstones([])).toEqual({ active: [], deleted: [] });
  });

  it('una página TODA de bajas no deja nada activo', () => {
    const { active, deleted } = splitTombstones([gone, { ...gone, id: 'e' }]);
    expect(active).toEqual([]);
    expect(deleted).toHaveLength(2);
  });
});
