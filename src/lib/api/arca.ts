import type { components } from '../../generated/api-types';
import { ApiError, apiRequest, apiRequestBytes } from './client';
import type { InvoiceSummaryDto } from './entries';

export type ArcaAccountDto = components['schemas']['ArcaAccountDto'];
export type ArcaTaxCondition = components['schemas']['ArcaTaxCondition'];
export type InvoiceDto = components['schemas']['InvoiceDto'];
export type TaxpayerDto = components['schemas']['TaxpayerDto'];
export type InvoiceReceiverDto = components['schemas']['InvoiceReceiverDto'];
type InvoiceChangesResponseDto =
  components['schemas']['InvoiceChangesResponseDto'];

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
 * `receiverCuit` sale identificada con ese CUIT (la letra la decide el
 * padrón); sin él, B o C a consumidor final.
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

/** Página del feed de sync de facturas (`syncSeq` > `afterSeq`). */
export function pullInvoiceChanges(input: {
  tenantId: string;
  bearer: string;
  afterSeq: number;
  limit: number;
}): Promise<InvoiceChangesResponseDto> {
  const qs = new URLSearchParams({
    afterSeq: String(input.afterSeq),
    limit: String(input.limit),
  });
  return apiRequest<InvoiceChangesResponseDto>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/invoices/changes?${qs.toString()}`,
    bearer: input.bearer,
  });
}

/** PDF de una factura emitida (409 `INVOICE_NOT_ISSUED` si no tiene CAE). */
export function downloadInvoicePdf(input: {
  tenantId: string;
  invoiceId: string;
  bearer: string;
}): Promise<Uint8Array> {
  return apiRequestBytes({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/invoices/${encodeURIComponent(input.invoiceId)}/pdf`,
    bearer: input.bearer,
  });
}

/**
 * Qué factura sale con este CUIT, según el padrón de ARCA (con caché en el
 * backend). 422 `ARCA_CUIT_INVALID`, 503 `ARCA_UNAVAILABLE`.
 */
export function lookupTaxpayer(input: {
  tenantId: string;
  cuit: string;
  bearer: string;
}): Promise<TaxpayerDto> {
  return apiRequest<TaxpayerDto>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/arca/taxpayers/${encodeURIComponent(input.cuit)}`,
    bearer: input.bearer,
  });
}

/** CUIT ya facturados en la playa, del más reciente al más viejo. */
export function listInvoiceReceivers(input: {
  tenantId: string;
  bearer: string;
  limit?: number;
}): Promise<InvoiceReceiverDto[]> {
  const qs = new URLSearchParams({ limit: String(input.limit ?? 20) });
  return apiRequest<InvoiceReceiverDto[]>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/invoice-receivers?${qs.toString()}`,
    bearer: input.bearer,
  });
}
