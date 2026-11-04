// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { localDb, type LocalRate } from '../../lib/db/localDb';
import {
  change,
  cleanup,
  click,
  field,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { RatesPanel } from './RatesPanel';

const api = vi.hoisted(() => ({
  createRate: vi.fn(),
  updateRate: vi.fn(),
  deactivateRate: vi.fn(),
}));
const network = vi.hoisted(() => ({ isOnline: true }));

vi.mock('../../lib/api/rates', () => api);
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({
    isOnline: network.isOnline,
    networkUp: network.isOnline,
    backendReachable: network.isOnline,
  }),
}));

const NOW = '2026-10-07T15:00:00.000Z';

function rate(overrides: Partial<LocalRate> = {}): LocalRate {
  return {
    id: 'auto',
    tenantId: 'tenant',
    name: 'DIA AUTO',
    hourPriceArs: '1500',
    stayPriceArs: '15000',
    fractionPriceArs: '125',
    mediaEstadiaPriceArs: '9000',
    autoFractionPrice: true,
    isActive: true,
    shortcutNumber: 1,
    version: 3,
    syncSeq: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function render(canManage = true) {
  return mount(
    <RatesPanel
      accessToken="token"
      userId="user"
      tenantId="tenant"
      canManage={canManage}
    />,
  );
}

async function fillNewRate() {
  await click('Nueva tarifa');
  await change(field('Nº atajo'), '3');
  await change(field('Nombre'), 'NOCHE');
  await change(field('Precio hora'), '2000');
  await change(
    document.querySelector<HTMLInputElement>('#rate-media-estadia-price')!,
    '10000',
  );
  await change(
    document.querySelector<HTMLInputElement>('#rate-stay-price')!,
    '18000',
  );
}

async function confirm(label: string) {
  const buttons = [...document.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === label,
  );
  await click(buttons[buttons.length - 1]);
}

describe('RatesPanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    network.isOnline = true;
    await localDb.rates.bulkPut([
      rate(),
      rate({ id: 'moto', name: 'MOTO', shortcutNumber: 2, isActive: false }),
    ]);
    api.createRate.mockImplementation(
      ({ body }: { body: { id: string; name: string } }) =>
        Promise.resolve({
          ...rate({ id: body.id, name: body.name, shortcutNumber: 3 }),
          hourPriceArs: 2000,
          stayPriceArs: 18000,
          fractionPriceArs: 166.67,
          mediaEstadiaPriceArs: 10000,
          shortcutNumber: 3,
        }),
    );
    api.updateRate.mockImplementation(({ rateId }: { rateId: string }) =>
      Promise.resolve({
        ...rate({ id: rateId, version: 4 }),
        hourPriceArs: 1500,
        stayPriceArs: 15000,
        fractionPriceArs: 125,
        mediaEstadiaPriceArs: 9000,
        isActive: false,
      }),
    );
    api.deactivateRate.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('lista las tarifas de la base local', async () => {
    await render();

    await waitForText('DIA AUTO');
    expect(pageText()).toContain('MOTO');
  });

  it('online crea en el backend y guarda la respuesta', async () => {
    await render();

    await fillNewRate();
    await click('Crear tarifa');

    expect(api.createRate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        bearer: 'token',
        body: expect.objectContaining({
          name: 'NOCHE',
          shortcutNumber: 3,
        }) as unknown,
      }),
    );
    await waitForText('Tarifa creada.');
    expect(
      (await localDb.rates.toArray()).some((r) => r.name === 'NOCHE'),
    ).toBe(true);
  });

  it('offline guarda localmente y encola la creación', async () => {
    network.isOnline = false;
    await render();

    await fillNewRate();
    await click('Crear tarifa');

    expect(api.createRate).not.toHaveBeenCalled();
    await waitForText('Tarifa guardada localmente.');
    const ops = await localDb.pendingOps.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      entityType: 'rate',
      operation: 'create',
      status: 'pending',
    });
  });

  it('valida el formulario antes de guardar', async () => {
    await render();

    await click('Nueva tarifa');
    await click('Crear tarifa');

    expect(api.createRate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('avisa si no hay cambios al editar', async () => {
    await render();
    await waitForText('DIA AUTO');

    await click('Editar DIA AUTO');
    await click('Guardar cambios');

    expect(api.updateRate).not.toHaveBeenCalled();
    await waitForText('No hay cambios para guardar.');
  });

  it('edita el nombre de una tarifa', async () => {
    await render();
    await waitForText('DIA AUTO');

    await click('Editar DIA AUTO');
    await change(field('Nombre'), 'DIA AUTO PLUS');
    await click('Guardar cambios');

    expect(api.updateRate).toHaveBeenCalledWith(
      expect.objectContaining({
        rateId: 'auto',
        expectedVersion: 3,
        body: expect.objectContaining({ name: 'DIA AUTO PLUS' }) as unknown,
      }),
    );
  });

  it('desactiva online y reactiva offline', async () => {
    await render();
    await waitForText('DIA AUTO');

    await click('Desactivar DIA AUTO');
    await confirm('Desactivar');
    expect(api.updateRate).toHaveBeenCalledWith(
      expect.objectContaining({ rateId: 'auto', body: { isActive: false } }),
    );
    await waitForText('Tarifa desactivada.');

    network.isOnline = false;
    await click('Reactivar MOTO');
    await confirm('Reactivar');
    await waitForText('Reactivada localmente.');
    expect((await localDb.rates.get('moto'))?.isActive).toBe(true);
  });

  it('elimina con confirmación y muestra el error del backend', async () => {
    api.deactivateRate.mockRejectedValueOnce(new ApiError(500, 'boom', null));
    await render();
    await waitForText('DIA AUTO');

    await click('Eliminar MOTO');
    await confirm('Eliminar');
    expect(document.querySelector('.toast-error')).toBeTruthy();

    await click('Eliminar MOTO');
    await confirm('Eliminar');
    await waitForText('Tarifa eliminada.');
    expect(await localDb.rates.get('moto')).toBeUndefined();
  });

  it('sin permisos no muestra acciones', async () => {
    await render(false);
    await waitForText('DIA AUTO');

    expect(pageText()).not.toContain('Nueva tarifa');
  });
});
