// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { localDb, type LocalLprIgnoredPlate } from '../../lib/db/localDb';
import {
  change,
  cleanup,
  click,
  field,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { LprWhitelistPanel } from './LprWhitelistPanel';

const api = vi.hoisted(() => ({
  createLprIgnoredPlate: vi.fn(),
  updateLprIgnoredPlate: vi.fn(),
  deleteLprIgnoredPlate: vi.fn(),
}));
const network = vi.hoisted(() => ({ isOnline: true }));

vi.mock('../../lib/api/lpr-ignored-plates', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({
    isOnline: network.isOnline,
    networkUp: network.isOnline,
    backendReachable: network.isOnline,
  }),
}));

const NOW = '2026-10-07T15:00:00.000Z';

function plate(
  overrides: Partial<LocalLprIgnoredPlate> = {},
): LocalLprIgnoredPlate {
  return {
    id: 'ambulancia',
    tenantId: 'tenant',
    plate: 'AB123CD',
    notes: 'Ambulancia del barrio',
    active: true,
    validFrom: null,
    validUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    version: 1,
    syncSeq: 1,
    ...overrides,
  };
}

function render(canManage = true) {
  return mount(
    <LprWhitelistPanel
      tenantId="tenant"
      accessToken="token"
      userId="user"
      canManage={canManage}
    />,
  );
}

async function confirm(label: string) {
  const buttons = [...document.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === label,
  );
  await click(buttons[buttons.length - 1]);
}

describe('LprWhitelistPanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    network.isOnline = true;
    await localDb.lprIgnoredPlates.bulkPut([
      plate(),
      plate({
        id: 'vieja',
        plate: 'XYZ999',
        notes: null,
        active: false,
        validFrom: '2026-01-01',
        validUntil: '2026-02-01',
      }),
    ]);
    api.createLprIgnoredPlate.mockImplementation(
      ({ body }: { body: Partial<LocalLprIgnoredPlate> }) =>
        Promise.resolve(plate({ ...body, version: 1 })),
    );
    // El backend devuelve la fila actualizada: se parte de la guardada.
    api.updateLprIgnoredPlate.mockImplementation(
      async ({ id, body }: { id: string; body: object }) => ({
        ...(await localDb.lprIgnoredPlates.get(id)),
        ...body,
        version: 2,
      }),
    );
    api.deleteLprIgnoredPlate.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(plate({ id, deletedAt: NOW })),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it('lista las patentes con su vigencia', async () => {
    await render();

    await waitForText('Ambulancia del barrio');
    expect(pageText()).toContain('XYZ999');
    expect(pageText()).toContain('01/01/2026');
  });

  it('agrega una patente online', async () => {
    await render();

    await click('Agregar patente');
    await change(field('Patente'), 'ac 456 de');
    await change(field<HTMLTextAreaElement>('Nota (opcional)'), 'Proveedor');
    await click('Guardar');

    expect(api.createLprIgnoredPlate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        body: expect.objectContaining({
          plate: 'AC456DE',
          notes: 'Proveedor',
        }) as unknown,
      }),
    );
  });

  it('rechaza una patente repetida', async () => {
    await render();

    await click('Agregar patente');
    await change(field('Patente'), 'AB123CD');
    await click('Guardar');

    expect(api.createLprIgnoredPlate).not.toHaveBeenCalled();
    expect(pageText()).toContain('ya está en la lista blanca');
  });

  it('offline guarda localmente y encola', async () => {
    network.isOnline = false;
    await render();
    await waitForText('Ambulancia del barrio');

    await click('Editar AB123CD');
    await change(field<HTMLTextAreaElement>('Nota (opcional)'), 'Ambulancia');
    await click('Guardar');

    expect(api.updateLprIgnoredPlate).not.toHaveBeenCalled();
    expect((await localDb.lprIgnoredPlates.get('ambulancia'))?.notes).toBe(
      'Ambulancia',
    );
    expect(await localDb.pendingOps.count()).toBe(1);
  });

  it('si el servidor no contesta encola en vez de perder el cambio', async () => {
    api.updateLprIgnoredPlate.mockRejectedValue(new ApiError(503, 'x', null));
    await render();
    await waitForText('Ambulancia del barrio');

    await click('Desactivar AB123CD');
    await confirm('Desactivar');

    expect((await localDb.lprIgnoredPlates.get('ambulancia'))?.active).toBe(
      false,
    );
    expect(await localDb.pendingOps.count()).toBe(1);
  });

  it('reactiva y elimina online', async () => {
    await render();
    await waitForText('XYZ999');

    await click('Reactivar XYZ999');
    await confirm('Reactivar');
    expect(api.updateLprIgnoredPlate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'vieja', body: { active: true } }),
    );

    await click('Eliminar XYZ999');
    await confirm('Eliminar');
    expect(api.deleteLprIgnoredPlate).toHaveBeenCalled();
    expect(await localDb.lprIgnoredPlates.get('vieja')).toBeUndefined();
  });

  it('muestra el error de validación del backend', async () => {
    api.deleteLprIgnoredPlate.mockRejectedValue(new ApiError(409, 'x', null));
    await render();
    await waitForText('XYZ999');

    await click('Eliminar XYZ999');
    await confirm('Eliminar');

    expect(document.querySelector('.toast-error')).toBeTruthy();
  });
});
