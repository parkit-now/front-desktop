// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { localDb, type LocalCashSession } from '../../lib/db/localDb';
import {
  change,
  cleanup,
  click,
  field,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { CashSessionStats } from './CashSessionStats';
import { NoCashSessionScreen } from './NoCashSessionScreen';

const api = vi.hoisted(() => ({ createCashSession: vi.fn() }));
const network = vi.hoisted(() => ({ isOnline: true }));

vi.mock('../../lib/api/cash-sessions', async (importOriginal) => ({
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

const NOW = new Date().toISOString();
const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString();

afterEach(async () => {
  await cleanup();
});

describe('NoCashSessionScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    network.isOnline = true;
    api.createCashSession.mockImplementation(
      ({ body }: { body: { id: string; openingCash: number } }) =>
        Promise.resolve({
          ...body,
          tenantId: 'tenant',
          openedAt: NOW,
          closedAt: null,
          leavingCash: null,
          notes: null,
          version: 1,
          syncSeq: 1,
          updatedAt: NOW,
        }),
    );
  });

  it('abre la caja online con el fondo inicial', async () => {
    await mount(<NoCashSessionScreen tenantId="tenant" accessToken="token" />);

    await change(field('0.00'), '1500,50');
    await click('Abrir caja');

    expect(api.createCashSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant',
        body: expect.objectContaining({ openingCash: 1500.5 }) as unknown,
      }),
    );
    await waitForText('Caja abierta');
    expect(await localDb.cashSessions.count()).toBe(1);
  });

  it('sin conexión la abre localmente y la encola', async () => {
    network.isOnline = false;
    await mount(<NoCashSessionScreen tenantId="tenant" accessToken="token" />);

    await click('Abrir caja');

    expect(api.createCashSession).not.toHaveBeenCalled();
    expect(await localDb.pendingOps.toArray()).toEqual([
      expect.objectContaining({
        entityType: 'cashSession',
        operation: 'create',
      }),
    ]);
  });

  it('avisa si el servidor rechaza la apertura', async () => {
    api.createCashSession.mockRejectedValue(new ApiError(409, 'x', null));
    await mount(<NoCashSessionScreen tenantId="tenant" accessToken="token" />);

    await click('Abrir caja');

    expect(document.querySelector('.toast-error')).toBeTruthy();
  });
});

describe('CashSessionStats', () => {
  const session: LocalCashSession = {
    id: 'caja-1',
    tenantId: 'tenant',
    openedAt: HOUR_AGO,
    openingCash: 1000,
    version: 1,
    syncSeq: 1,
    updatedAt: NOW,
  };

  beforeEach(async () => {
    await localDb.entries.bulkPut([
      {
        id: 'e-1',
        tenantId: 'tenant',
        plate: 'AB123CD',
        enteredAt: HOUR_AGO,
        leftAt: NOW,
        amountPaid: '3000',
        cashSessionId: 'caja-1',
        version: 1,
        syncSeq: 1,
        updatedAt: NOW,
      },
      {
        id: 'e-2',
        tenantId: 'tenant',
        plate: 'XYZ999',
        enteredAt: HOUR_AGO,
        cashSessionId: 'caja-1',
        version: 1,
        syncSeq: 1,
        updatedAt: NOW,
      },
    ]);
    await localDb.paymentTransactions.bulkPut([
      {
        id: 'p-1',
        tenantId: 'tenant',
        entryId: 'e-1',
        cashSessionId: 'caja-1',
        paymentMethodName: 'Efectivo',
        paymentMethodType: 'cash',
        amount: 2000,
        version: 1,
        syncSeq: 1,
        updatedAt: NOW,
      },
      {
        id: 'p-2',
        tenantId: 'tenant',
        entryId: 'e-1',
        cashSessionId: 'caja-1',
        paymentMethodName: 'Mercado Pago QR',
        paymentMethodType: 'mercadopago_qr',
        amount: 1000,
        version: 1,
        syncSeq: 1,
        updatedAt: NOW,
      },
    ]);
  });

  it('resume lo recaudado y el arqueo de efectivo', async () => {
    await mount(<CashSessionStats session={session} />);

    await waitForText('Total recaudado');
    expect(pageText()).toContain('Cobros por medio de pago');
    expect(pageText()).toContain('Mercado Pago QR');
    expect(pageText()).toContain('Arqueo de efectivo');
    expect(pageText()).toMatch(/3\.000/);
  });

  it('muestra el cierre de una caja cerrada', async () => {
    await mount(
      <CashSessionStats
        session={{ ...session, closedAt: NOW, leavingCash: 500 }}
      />,
    );

    await waitForText('Fondo dejado al siguiente turno');
  });
});
