import type { components } from '../../generated/api-types';
import { ApiError, apiRequest } from './client';
import type { InvoiceSummaryDto } from './entries';

export type ArcaAccountDto = components['schemas']['ArcaAccountDto'];
export type ArcaTaxCondition = components['schemas']['ArcaTaxCondition'];

/** Cuenta ARCA de la playa, o `null` si no está vinculada (404). */
export async function getArcaAccount(input: {
  tenantId: string;
  bearer: string;
}): Promise<ArcaAccountDto | null> {
  try {
    return await apiRequest<ArcaAccountDto>({
      method: 'GET',
      path: `/tenants/${encodeURIComponent(input.tenantId)}/arca/account`,
      bearer: input.bearer,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Emite (o reintenta) la factura de una estadía ya cobrada. Con
 * `receiverCuit` sale una A; sin él, B o C a consumidor final.
 */
export function issueInvoice(input: {
  tenantId: string;
  entryId: string;
  bearer: string;
  receiverCuit?: string;
}): Promise<InvoiceSummaryDto> {
  return apiRequest<InvoiceSummaryDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/entries/${encodeURIComponent(input.entryId)}/invoice`,
    body: input.receiverCuit ? { receiverCuit: input.receiverCuit } : {},
    bearer: input.bearer,
  });
}
