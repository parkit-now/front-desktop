import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshInvoiceHistory } from './invoiceHistory';

const pullInvoices = vi.hoisted(() => vi.fn());

vi.mock('../../lib/sync/SyncService', () => ({
  syncService: { pullInvoices },
}));
beforeEach(() => vi.resetAllMocks());
describe('actualizacion fiscal del historial', () => {
  it('espera la escritura local con las credenciales del estacionamiento', async () => {
    let finish!: () => void;
    pullInvoices.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    let completed = false;
    const pending = refreshInvoiceHistory({
      tenantId: 'tenant',
      bearer: 'token',
    }).then((result) => {
      completed = true;
      return result;
    });
    expect(completed).toBe(false);
    expect(pullInvoices).toHaveBeenCalledWith({
      tenantId: 'tenant',
      bearer: 'token',
    });
    finish();
    await expect(pending).resolves.toBe(true);
  });
  it('informa un refresco fallido sin rechazar una operacion ya guardada', async () => {
    pullInvoices.mockRejectedValueOnce(new Error('offline'));
    await expect(
      refreshInvoiceHistory({ tenantId: 'tenant', bearer: 'token' }),
    ).resolves.toBe(false);
  });
});
