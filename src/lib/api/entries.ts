import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type EntryDto = components['schemas']['EntryDto'];
export type CreateEntryDto = components['schemas']['CreateEntryDto'];
export type CloseEntryDto = components['schemas']['CloseEntryDto'];
export type EntryChangesResponseDto =
  components['schemas']['EntryChangesResponseDto'];

/**
 * Aliases del contrato generado, NO copias a mano. Eran dos `type` escritos
 * acá y les faltaba `paymentMethodType`: una corrección BORRA y RECREA las
 * transacciones, así que sin ese campo corregir un cobro en efectivo lo
 * degradaba a "otros medios" y descuadraba el arqueo.
 */
export type CorrectEntryPaymentLineDto =
  components['schemas']['PaymentLineDto'];
export type CorrectEntryDto = components['schemas']['CorrectEntryDto'];

type EntryChangesQuery = {
  afterSeq?: number;
  limit?: number;
};

function withQuery(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `${path}?${encoded}` : path;
}

export function createEntry(input: {
  tenantId: string;
  bearer: string;
  body: CreateEntryDto;
}): Promise<EntryDto> {
  return apiRequest<EntryDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/entries`,
    body: input.body,
    bearer: input.bearer,
  });
}

export function pullEntryChanges(input: {
  tenantId: string;
  bearer: string;
  query?: EntryChangesQuery;
}): Promise<EntryChangesResponseDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/entries/changes`;
  const path = withQuery(basePath, {
    afterSeq: input.query?.afterSeq,
    limit: input.query?.limit,
  });
  return apiRequest<EntryChangesResponseDto>({
    method: 'GET',
    path,
    bearer: input.bearer,
  });
}

export function closeEntry(input: {
  tenantId: string;
  entryId: string;
  expectedVersion: number;
  bearer: string;
  body: CloseEntryDto;
}): Promise<EntryDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/entries/${encodeURIComponent(input.entryId)}`;
  const path = withQuery(basePath, { expectedVersion: input.expectedVersion });
  return apiRequest<EntryDto>({
    method: 'PATCH',
    path,
    body: input.body,
    bearer: input.bearer,
  });
}

export function correctEntry(input: {
  tenantId: string;
  entryId: string;
  expectedVersion: number;
  bearer: string;
  body: CorrectEntryDto;
}): Promise<EntryDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/entries/${encodeURIComponent(input.entryId)}/correction`;
  const path = withQuery(basePath, { expectedVersion: input.expectedVersion });
  return apiRequest<EntryDto>({
    method: 'PATCH',
    path,
    body: input.body,
    bearer: input.bearer,
  });
}
