import { syncService } from '../../lib/sync/SyncService';

export const INVOICE_HISTORY_REFRESH_WARNING =
  'No pudimos actualizar las facturas del historial. Sincronizá para ver los últimos cambios.';

// Un fallo del refresco no convierte un cobro o una emision confirmados en fallidos.
export async function refreshInvoiceHistory(input: {
  tenantId: string;
  bearer: string;
}): Promise<boolean> {
  try {
    await syncService.pullInvoices(input);
    return true;
  } catch {
    return false;
  }
}
