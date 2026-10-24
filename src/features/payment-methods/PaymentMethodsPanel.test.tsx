// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { localDb, type LocalPaymentMethod } from '../../lib/db/localDb';
import {
  change,
  cleanup,
  click,
  field,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { PaymentMethodsPanel } from './PaymentMethodsPanel';

const api = vi.hoisted(() => ({
  createPaymentMethod: vi.fn(),
  togglePaymentMethod: vi.fn(),
  deletePaymentMethod: vi.fn(),
}));
const network = vi.hoisted(() => ({ isOnline: true }));

vi.mock('../../lib/api/payment-methods', async (importOriginal) => ({
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

function method(
  overrides: Partial<LocalPaymentMethod> = {},
): LocalPaymentMethod {
  return {
    id: 'efectivo',
    tenantId: 'tenant',
    type: 'cash',
    name: 'Efectivo',
    enabled: true,
    isDefault: true,
    isSystem: true,
    invoiceMode: 'none',
    syncSeq: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function dto(overrides: Partial<LocalPaymentMethod> = {}) {
  return { ...method(overrides), deletedAt: null };
}

function render() {
  return mount(
    <PaymentMethodsPanel
      accessToken="token"
      userId="user"
      tenantId="tenant"
      canManage
    />,
  );
}

async function confirm(label: string) {
  const buttons = [...document.querySelectorAll('button')].filter(
    (b) => b.textContent?.trim() === label,
  );
  await click(buttons[buttons.length - 1]);
}

describe('PaymentMethodsPanel', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    network.isOnline = true;
    await localDb.paymentMethods.bulkPut([
      method(),
      method({
        id: 'transfer',
        type: 'transfer',
        name: 'Transferencia',
        isDefault: false,
        isSystem: false,
      }),
      method({
        id: 'qr',
        type: 'mercadopago_qr',
        name: 'Mercado Pago QR',
        isDefault: false,
        enabled: false,
      }),
    ]);
    api.createPaymentMethod.mockImplementation(
      ({ body }: { body: { name: string } }) =>
        Promise.resolve(
          dto({
            id: 'nuevo',
            name: body.name,
            isDefault: false,
            isSystem: false,
          }),
        ),
    );
    api.togglePaymentMethod.mockImplementation(
      ({ id, body }: { id: string; body: object }) =>
        Promise.resolve(dto({ id, isSystem: false, ...body })),
    );
    api.deletePaymentMethod.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('lista los métodos de la base local', async () => {
    await render();

    await waitForText('Transferencia');
    expect(pageText()).toContain('Mercado Pago QR');
  });

  it('crea un método online', async () => {
    await render();

    await click('Nuevo método');
    await change(field('Nombre (ej. Naranja X)'), 'Naranja X');
    await click('Crear método');

    expect(api.createPaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ name: 'Naranja X' }) as unknown,
      }),
    );
    await waitForText('Método de pago creado.');
  });

  it('crea un método offline y lo encola', async () => {
    network.isOnline = false;
    await render();

    await click('Nuevo método');
    await change(field('Nombre (ej. Naranja X)'), 'Cheque');
    await click('Crear método');

    expect(api.createPaymentMethod).not.toHaveBeenCalled();
    await waitForText('Método guardado localmente.');
    expect(await localDb.pendingOps.count()).toBe(1);
  });

  it('renombra un método', async () => {
    await render();
    await waitForText('Transferencia');

    await click('Editar Transferencia');
    await change(field('Nombre (ej. Naranja X)'), 'Transferencia bancaria');
    await click('Guardar cambios');

    expect(api.togglePaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          name: 'Transferencia bancaria',
        }) as unknown,
      }),
    );
  });

  it('deshabilita un método con confirmación', async () => {
    await render();
    await waitForText('Transferencia');

    await click('Deshabilitar Transferencia');
    await confirm('Deshabilitar');

    expect(api.togglePaymentMethod).toHaveBeenCalledWith(
      expect.objectContaining({ body: { enabled: false } }),
    );
  });

  it('marca otro método como predeterminado', async () => {
    await render();
    await waitForText('Transferencia');

    await click('Marcar Transferencia como predeterminado');
    await confirm('Marcar predeterminado');

    await waitForText('Predeterminado actualizado.');
    expect((await localDb.paymentMethods.get('efectivo'))?.isDefault).toBe(
      false,
    );
  });

  it('elimina un método propio y muestra el error del backend', async () => {
    api.deletePaymentMethod.mockRejectedValueOnce(
      new ApiError(500, 'boom', null),
    );
    await render();
    await waitForText('Transferencia');

    await click('Eliminar Transferencia');
    await confirm('Eliminar');
    expect(document.querySelector('.toast-error')).toBeTruthy();

    await click('Eliminar Transferencia');
    await confirm('Eliminar');
    await waitForText('Método eliminado.');
    expect(await localDb.paymentMethods.get('transfer')).toBeUndefined();
  });

  it('el QR de Mercado Pago se administra desde el panel web', async () => {
    await render();
    await waitForText('Mercado Pago QR');

    expect(
      document.querySelector(
        '[aria-label="Mercado Pago QR se administra desde Integraciones en el panel web y no se puede eliminar"]',
      ),
    ).toBeTruthy();
  });
});
