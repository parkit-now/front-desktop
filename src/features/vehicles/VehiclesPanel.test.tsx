// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import {
  localDb,
  type LocalVehicle,
  type LocalVehicleType,
} from '../../lib/db/localDb';
import {
  change,
  choose,
  cleanup,
  click,
  field,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { VehicleTypesPanel } from '../vehicle-types/VehicleTypesPanel';
import { VehiclesPanel } from './VehiclesPanel';

const vehicles = vi.hoisted(() => ({
  createTenantVehicle: vi.fn(),
  updateTenantVehicle: vi.fn(),
  deleteTenantVehicle: vi.fn(),
}));
const types = vi.hoisted(() => ({
  createVehicleType: vi.fn(),
  updateVehicleType: vi.fn(),
  deleteVehicleType: vi.fn(),
}));
const network = vi.hoisted(() => ({ isOnline: true }));

vi.mock('../../lib/api/vehicles', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...vehicles,
}));
vi.mock('../../lib/api/vehicle-types', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...types,
}));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({
    isOnline: network.isOnline,
    networkUp: network.isOnline,
    backendReachable: network.isOnline,
  }),
}));

const NOW = '2026-10-07T15:00:00.000Z';

function type(overrides: Partial<LocalVehicleType> = {}): LocalVehicleType {
  return {
    id: 'auto',
    tenantId: 'tenant',
    name: 'Auto',
    accepted: true,
    category: 'car',
    version: 2,
    syncSeq: 1,
    updatedAt: NOW,
    ...overrides,
  } as LocalVehicleType;
}

function vehicle(overrides: Partial<LocalVehicle> = {}): LocalVehicle {
  return {
    id: 'bora',
    tenantId: 'tenant',
    brand: 'Volkswagen',
    model: 'Bora',
    typeId: 'auto',
    version: 4,
    syncSeq: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

async function confirm(label: string) {
  const buttons = [...document.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === label,
  );
  await click(buttons[buttons.length - 1]);
}

beforeEach(async () => {
  vi.clearAllMocks();
  network.isOnline = true;
  await localDb.vehicleCategories.bulkPut([
    { code: 'car', label: 'Auto', sortOrder: 1, reservable: true },
    { code: 'motorcycle', label: 'Moto', sortOrder: 2, reservable: true },
  ]);
  await localDb.vehicleTypes.bulkPut([
    type(),
    type({ id: 'moto', name: 'Moto', category: 'motorcycle' }),
    type({ id: 'scooter', name: 'Scooter', category: 'motorcycle' }),
  ]);
  await localDb.vehicles.bulkPut([
    vehicle(),
    vehicle({ id: 'cg', brand: 'Honda', model: 'CG 150', typeId: 'moto' }),
  ]);
});

afterEach(async () => {
  await cleanup();
});

describe('VehiclesPanel', () => {
  function render() {
    return mount(
      <VehiclesPanel
        accessToken="token"
        userId="user"
        tenantId="tenant"
        canManage
      />,
    );
  }

  it('lista el catálogo de la base local', async () => {
    await render();

    await waitForText('Bora');
    expect(pageText()).toContain('CG 150');
  });

  it('online agrega el vehículo y guarda la respuesta', async () => {
    vehicles.createTenantVehicle.mockImplementation(
      ({ body }: { body: { id: string } }) =>
        Promise.resolve({
          ...vehicle({ id: body.id, brand: 'Fiat', model: 'Cronos' }),
          deletedAt: null,
        }),
    );
    await render();

    await click('Nuevo vehículo');
    await change(field('Marca (ej. Volkswagen)'), 'Fiat');
    await change(field('Modelo (ej. Bora)'), 'Cronos');
    await choose('vehicle-type', 'Auto');
    await click('Agregar vehículo');

    expect(vehicles.createTenantVehicle).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        body: expect.objectContaining({
          brand: 'Fiat',
          model: 'Cronos',
        }) as unknown,
      }),
    );
    await waitForText('Cronos');
  });

  it('offline edita localmente y encola el cambio', async () => {
    network.isOnline = false;
    await render();
    await waitForText('Bora');

    await click('Editar Volkswagen Bora');
    await change(field('Modelo (ej. Bora)'), 'Vento');
    await click('Guardar cambios');

    expect(vehicles.updateTenantVehicle).not.toHaveBeenCalled();
    expect((await localDb.vehicles.get('bora'))?.model).toBe('Vento');
    expect(await localDb.pendingOps.toArray()).toEqual([
      expect.objectContaining({ entityType: 'vehicle', operation: 'update' }),
    ]);
  });

  it('elimina después de confirmar y avisa los errores', async () => {
    vehicles.deleteTenantVehicle
      .mockRejectedValueOnce(new ApiError(500, 'boom', null))
      .mockResolvedValue(undefined);
    await render();
    await waitForText('CG 150');

    await click('Eliminar Honda CG 150');
    await confirm('Eliminar');
    expect(document.querySelector('.toast-error')).toBeTruthy();

    await click('Eliminar Honda CG 150');
    await confirm('Eliminar');
    await waitForText('Vehículo eliminado.');
    expect(await localDb.vehicles.get('cg')).toBeUndefined();
  });

  it('avisa si no hay cambios', async () => {
    await render();
    await waitForText('Bora');

    await click('Editar Volkswagen Bora');
    await click('Guardar cambios');

    await waitForText('No hay cambios para guardar.');
  });
});

describe('VehicleTypesPanel', () => {
  function render() {
    return mount(
      <VehicleTypesPanel accessToken="token" tenantId="tenant" canManage />,
    );
  }

  it('lista los tipos', async () => {
    await render();

    await waitForText('Scooter');
  });

  it('crea un tipo online', async () => {
    types.createVehicleType.mockImplementation(
      ({ body }: { body: { id: string; name: string } }) =>
        Promise.resolve({ ...type({ id: body.id, name: body.name }) }),
    );
    await render();

    await click('Nuevo tipo');
    await change(field('Ej. Utilitario'), 'Utilitario');
    await choose('vehicle-type-category', 'Auto');
    await click('Guardar');

    expect(types.createVehicleType).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'Utilitario',
          category: 'car',
        }) as unknown,
      }),
    );
  });

  it('offline renombra localmente', async () => {
    network.isOnline = false;
    await render();
    await waitForText('Scooter');

    await click('Editar Scooter');
    await change(field('Ej. Utilitario'), 'Scooter eléctrico');
    await click('Guardar');

    expect((await localDb.vehicleTypes.get('scooter'))?.name).toBe(
      'Scooter eléctrico',
    );
    expect(await localDb.pendingOps.count()).toBe(1);
  });

  it('elimina un tipo sin uso', async () => {
    types.deleteVehicleType.mockResolvedValue({ reassignedVehicles: 0 });
    await render();
    await waitForText('Scooter');

    await click('Eliminar Scooter');
    await confirm('Eliminar');

    expect(types.deleteVehicleType).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: 'scooter', expectedVersion: 2 }),
    );
    await waitForText('Tipo eliminado.');
  });

  it('pide reasignar los vehículos de un tipo en uso', async () => {
    types.deleteVehicleType.mockResolvedValue({ reassignedVehicles: 1 });
    await render();
    await waitForText('Moto');

    await click('Eliminar Moto');
    await choose('reassign-target', 'Scooter');
    await click('Eliminar y reasignar');

    expect(types.deleteVehicleType).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: 'moto', reassignToTypeId: 'scooter' }),
    );
    await waitForText('Movimos 1 vehículo(s).');
  });
});
