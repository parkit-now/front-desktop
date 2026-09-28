import { describe, expect, it } from 'vitest';
import {
  decidePrune,
  PRUNE_MIN_ABSOLUTE,
  reconcileStateKey,
  shouldReconcile,
} from './reconcile';

const NADA = new Set<string>();

function decide(input: {
  localIds: string[];
  serverIds: string[];
  dirtyIds?: Set<string>;
  serverComplete?: boolean;
}) {
  return decidePrune({
    localIds: input.localIds,
    serverIds: input.serverIds,
    dirtyIds: input.dirtyIds ?? NADA,
    serverComplete: input.serverComplete ?? true,
  });
}

describe('decidePrune', () => {
  it('poda la fila que el servidor no menciona', () => {
    // El caso que motiva todo esto: una tarifa borrada físicamente durante la
    // ventana de bug, que el feed incremental no va a mencionar nunca más.
    const d = decide({ localIds: ['a', 'fantasma'], serverIds: ['a'] });
    expect(d.prune).toEqual(['fantasma']);
    expect(d.seal).toBe(true);
  });

  it('no poda nada cuando lo local y lo del servidor coinciden', () => {
    const d = decide({ localIds: ['a', 'b'], serverIds: ['b', 'a'] });
    expect(d.prune).toEqual([]);
    expect(d).toMatchObject({ skip: 'nothing-to-prune', seal: true });
  });

  it('NO poda una fila con una operación encolada', () => {
    // Lo más probable es que sea un alta local que todavía no se pusheó: el
    // servidor no la conoce porque todavía no se enteró.
    const d = decide({
      localIds: ['a', 'recien-creada'],
      serverIds: ['a'],
      dirtyIds: new Set(['recien-creada']),
    });
    expect(d.prune).toEqual([]);
  });

  it('no borra nada si la lista del servidor llegó cortada', () => {
    // Lo que falta podría ser una fila viva.
    const d = decide({
      localIds: ['a', 'b'],
      serverIds: ['a'],
      serverComplete: false,
    });
    expect(d).toMatchObject({ prune: [], skip: 'incomplete' });
  });

  it('NO sella cuando la lista llegó cortada, para reintentar', () => {
    const d = decide({ localIds: ['a'], serverIds: [], serverComplete: false });
    expect(d.seal).toBe(false);
  });

  it('no borra nada si el servidor devuelve vacío y hay filas locales', () => {
    // Un tenant legítimamente vacío y un bug que devuelve [] son
    // indistinguibles, y equivocarse deja al operador sin poder cobrar.
    const d = decide({ localIds: ['a', 'b'], serverIds: [] });
    expect(d).toMatchObject({ prune: [], skip: 'empty-server' });
  });

  it('sella el caso de servidor vacío: reintentar no lo va a cambiar', () => {
    expect(decide({ localIds: ['a'], serverIds: [] }).seal).toBe(true);
  });

  it('no borra nada si la poda se pasa de la mitad del total', () => {
    // La red contra un filtro mal puesto del lado del servidor — el caso real
    // es `listRates` sin `includeInactive`, que se comería las desactivadas.
    const d = decide({
      localIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      serverIds: ['a'],
    });
    expect(d).toMatchObject({ prune: [], skip: 'too-many' });
  });

  it('sí poda aunque sea más de la mitad, si son pocas en total', () => {
    // Sin el piso absoluto, el porcentaje haría inútil la reconciliación justo
    // en los catálogos chicos, que son la mayoría.
    const d = decide({ localIds: ['a', 'b', 'c'], serverIds: ['a'] });
    expect(d.prune).toEqual(['b', 'c']);
  });

  it('el piso absoluto es el que decide en el borde', () => {
    // Exactamente PRUNE_MIN_ABSOLUTE a podar: pasa, porque el tope exige
    // superarlo, no igualarlo.
    const localIds = ['a', 'b', 'c', 'd'];
    const d = decide({ localIds, serverIds: ['a'] });
    expect(d.prune).toHaveLength(PRUNE_MIN_ABSOLUTE);
  });

  it('las filas sucias no cuentan para el tope', () => {
    // Si contaran, una tanda de altas offline podría bloquear la poda de un
    // fantasma real.
    const d = decide({
      localIds: ['a', 'x1', 'x2', 'x3', 'x4', 'fantasma'],
      serverIds: ['a'],
      dirtyIds: new Set(['x1', 'x2', 'x3', 'x4']),
    });
    expect(d.prune).toEqual(['fantasma']);
  });
});

describe('shouldReconcile', () => {
  const now = Date.UTC(2026, 8, 28, 12, 0, 0);
  const seisHoras = 6 * 60 * 60 * 1000;

  it('corre si nunca corrió', () => {
    expect(
      shouldReconcile({
        lastRunAt: undefined,
        intervalMs: seisHoras,
        now,
        force: false,
      }),
    ).toBe(true);
  });

  it('no corre dentro del intervalo', () => {
    expect(
      shouldReconcile({
        lastRunAt: new Date(now - 60_000).toISOString(),
        intervalMs: seisHoras,
        now,
        force: false,
      }),
    ).toBe(false);
  });

  it('corre pasado el intervalo', () => {
    expect(
      shouldReconcile({
        lastRunAt: new Date(now - seisHoras - 1).toISOString(),
        intervalMs: seisHoras,
        now,
        force: false,
      }),
    ).toBe(true);
  });

  it('el botón manual fuerza aunque recién haya corrido', () => {
    // Es la salida que tiene el operador cuando ve algo que no debería estar.
    expect(
      shouldReconcile({
        lastRunAt: new Date(now).toISOString(),
        intervalMs: seisHoras,
        now,
        force: true,
      }),
    ).toBe(true);
  });

  it('un sello corrupto no bloquea para siempre', () => {
    expect(
      shouldReconcile({
        lastRunAt: 'no-es-una-fecha',
        intervalMs: seisHoras,
        now,
        force: false,
      }),
    ).toBe(true);
  });
});

describe('reconcileStateKey', () => {
  it('no la barre un reset de cursor', () => {
    // Los upgrades del esquema local borran cursores con
    // `key.startsWith('<entidad>:')`. Si el prefijo fuera sufijo, el próximo
    // reset se llevaría puesto el sello y la reconciliación correría de cero.
    const key = reconcileStateKey('rate', 'tenant-1');
    expect(key.startsWith('rates:')).toBe(false);
    expect(key.startsWith('rate:')).toBe(false);
    expect(key).toBe('reconcile:rate:tenant-1');
  });
});
