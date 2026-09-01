import { describe, expect, it } from 'vitest';
import { vehicleToLocal, vehicleTypeToLocal } from './SyncService';

describe('vehicleToLocal', () => {
  const dto = {
    id: 'v-1',
    brand: 'Renault',
    model: 'Kangoo',
    typeId: 't-1',
    tenantId: 'tenant-1',
    version: 3,
    syncSeq: 42,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  it('mapea los campos del catálogo', () => {
    expect(vehicleToLocal(dto)).toEqual({
      id: 'v-1',
      brand: 'Renault',
      model: 'Kangoo',
      typeId: 't-1',
      tenantId: 'tenant-1',
      version: 3,
      syncSeq: 42,
      deletedAt: undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('convierte `deletedAt: null` en undefined', () => {
    // Dexie no indexa `null` igual que `undefined`, y las lecturas del panel
    // filtran con `!v.deletedAt`. Mantener el `null` del backend haría que un
    // vehículo vivo se comportara distinto según de dónde vino la fila.
    expect(vehicleToLocal(dto).deletedAt).toBeUndefined();
  });

  it('conserva el deletedAt de un tombstone', () => {
    const tombstone = { ...dto, deletedAt: '2026-02-01T00:00:00.000Z' };
    expect(vehicleToLocal(tombstone).deletedAt).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });
});

describe('vehicleTypeToLocal', () => {
  const dto = {
    id: 't-1',
    tenantId: 'tenant-1',
    name: 'Utilitario',
    accepted: true,
    version: 1,
    syncSeq: 7,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  it('mapea nombre y accepted', () => {
    const local = vehicleTypeToLocal(dto);
    expect(local.name).toBe('Utilitario');
    expect(local.accepted).toBe(true);
    expect(local.deletedAt).toBeUndefined();
  });

  it('conserva el deletedAt de un tombstone', () => {
    expect(
      vehicleTypeToLocal({ ...dto, deletedAt: '2026-02-01T00:00:00.000Z' })
        .deletedAt,
    ).toBe('2026-02-01T00:00:00.000Z');
  });
});
