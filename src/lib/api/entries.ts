import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type EntryDto = components['schemas']['EntryDto'];
export type CreateEntryDto = components['schemas']['CreateEntryDto'];
export type CloseEntryDto = components['schemas']['CloseEntryDto'];
export type EntryChangesResponseDto =
  components['schemas']['EntryChangesResponseDto'];

export type CorrectEntryPaymentLineDto = {
  id: string;
  paymentMethodId?: string;
  paymentMethodName: string;
  amount: number;
};

export type CorrectEntryDto = {
  plate?: string;
  color?: string;
  cochera?: string;
  notes?: string;
  enteredAt?: string;
  leftAt?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  rateId?: string;
  rateSnapshotName?: string;
  rateSnapshotHourPriceArs?: number;
  rateSnapshotStayPriceArs?: number;
  rateSnapshotFractionPriceArs?: number;
  payments?: CorrectEntryPaymentLineDto[];
  reason?: string;
};

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
