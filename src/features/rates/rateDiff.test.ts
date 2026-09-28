import { describe, expect, it } from 'vitest';
import type { LocalEntry } from '../../lib/db/localDb';
import {
  diffRateUpdate,
  hasPriceChange,
  nextSnapshotFromRate,
  openEntriesForRate,
  toMoneyNumber,
  type RateFormValues,
  type RatePrices,
} from './rateDiff';

function tarifa(overrides: Partial<RatePrices> = {}): RatePrices {
  return {
    name: 'NOCHE AUTO',
    hourPriceArs: '3500',
    stayPriceArs: '9000',
    fractionPriceArs: '290',
    mediaEstadiaPriceArs: '4500',
    autoFractionPrice: false,
    ...overrides,
  };
}

function valores(overrides: Partial<RateFormValues> = {}): RateFormValues {
  return {
    name: 'NOCHE AUTO',
    hourPriceArs: 3500,
    stayPriceArs: 9000,
    fractionPriceArs: 290,
    mediaEstadiaPriceArs: 4500,
    autoFractionPrice: false,
    shortcutNumber: undefined,
    ...overrides,
  };
}

describe('hasPriceChange', () => {
  it.each([
    ['hora', { hourPriceArs: 3900 }],
    ['fracción', { fractionPriceArs: 325 }],
    ['media estadía', { mediaEstadiaPriceArs: 5000 }],
    ['estadía', { stayPriceArs: 9800 }],
  ])('un cambio de %s dispara la pregunta', (_caso, body) => {
    expect(hasPriceChange(body)).toBe(true);
  });

  it.each([
    ['el nombre', { name: 'OTRO' }],
    ['el atajo', { shortcutNumber: 3 }],
    ['activar/desactivar', { isActive: false }],
  ])('un cambio de %s NO dispara la pregunta', (_caso, body) => {
    // Nada de esto cambia lo que se le cobra al auto. Preguntar sería ruido
    // que el operador aprende a saltear sin leer.
    expect(hasPriceChange(body)).toBe(false);
  });

  it('el flag de fracción automática solo no cuenta', () => {
    // Es preferencia del formulario; el motor de cobro ni la mira.
    expect(hasPriceChange({ autoFractionPrice: true })).toBe(false);
  });

  it('pero si además reescribió la fracción, sí cuenta', () => {
    // El disparador es siempre el campo de precio, nunca el flag.
    expect(
      hasPriceChange({ autoFractionPrice: true, fractionPriceArs: 325 }),
    ).toBe(true);
  });

  it('un body vacío no dispara nada', () => {
    expect(hasPriceChange({})).toBe(false);
  });

  it('un precio puesto en cero sigue siendo un cambio de precio', () => {
    // `0` es falsy: mirar presencia de clave y no el valor es lo que lo salva.
    expect(hasPriceChange({ mediaEstadiaPriceArs: 0 })).toBe(true);
  });
});

describe('diffRateUpdate', () => {
  it('sin cambios devuelve un body vacío', () => {
    expect(diffRateUpdate(valores(), tarifa())).toEqual({});
  });

  it('manda sólo lo que cambió', () => {
    const body = diffRateUpdate(valores({ hourPriceArs: 3900 }), tarifa());
    expect(body).toEqual({ hourPriceArs: 3900 });
  });

  it('compara los precios como números, no como texto', () => {
    // En Dexie los precios son `string` para no perder precisión; '3500.00' y
    // 3500 son el mismo precio y no tienen que viajar como un cambio.
    const body = diffRateUpdate(valores(), tarifa({ hourPriceArs: '3500.00' }));
    expect(body).toEqual({});
  });
});

describe('openEntriesForRate', () => {
  const entrada = (overrides: Partial<LocalEntry>): LocalEntry =>
    ({ id: 'e', tenantId: 't-1', rateId: 'r-1', ...overrides }) as LocalEntry;

  it('devuelve las que siguen adentro con esa tarifa', () => {
    const rows = [entrada({ id: 'e-1' }), entrada({ id: 'e-2' })];
    expect(openEntriesForRate(rows, 'r-1').map((e) => e.id)).toEqual([
      'e-1',
      'e-2',
    ]);
  });

  it('excluye las que ya salieron', () => {
    const rows = [entrada({ id: 'e-1', leftAt: '2026-09-01T10:00:00.000Z' })];
    expect(openEntriesForRate(rows, 'r-1')).toEqual([]);
  });

  it('excluye las de otra tarifa', () => {
    // Si editás "Auto por hora" no se tocan las camionetas.
    expect(openEntriesForRate([entrada({ rateId: 'r-2' })], 'r-1')).toEqual([]);
  });

  it('excluye las que creó la cámara, que no tienen tarifa', () => {
    // Nacen sin `rateId` ni snapshot: no hay precio congelado que actualizar.
    expect(openEntriesForRate([entrada({ rateId: undefined })], 'r-1')).toEqual(
      [],
    );
  });
});

describe('nextSnapshotFromRate', () => {
  it('escribe los CUATRO precios aunque haya cambiado uno solo', () => {
    // Igual que el backend: es lo que cumple lo que promete el diálogo y evita
    // dejar en estado mixto una estadía cuyo snapshot ya hubiera divergido.
    expect(nextSnapshotFromRate(tarifa(), { hourPriceArs: 3900 })).toEqual({
      rateSnapshotHourPriceArs: '3900',
      rateSnapshotFractionPriceArs: '290',
      rateSnapshotMediaEstadiaPriceArs: '4500',
      rateSnapshotStayPriceArs: '9000',
    });
  });

  it('un precio en cero se escribe como cero, no se descarta', () => {
    const snap = nextSnapshotFromRate(tarifa(), { mediaEstadiaPriceArs: 0 });
    expect(snap.rateSnapshotMediaEstadiaPriceArs).toBe('0');
  });

  it('una tarifa sin media estadía guardada no rompe', () => {
    const snap = nextSnapshotFromRate(
      tarifa({ mediaEstadiaPriceArs: undefined }),
      { hourPriceArs: 3900 },
    );
    expect(snap.rateSnapshotMediaEstadiaPriceArs).toBe('0');
  });
});

describe('toMoneyNumber', () => {
  it.each([
    ['3500', 3500],
    ['3500.50', 3500.5],
    [undefined, 0],
    ['', 0],
    ['no es plata', 0],
  ])('%s → %s', (input, expected) => {
    expect(toMoneyNumber(input)).toBe(expected);
  });
});
