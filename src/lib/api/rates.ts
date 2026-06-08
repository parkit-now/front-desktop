import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type RateDto = components['schemas']['RateDto'];
export type CreateRateDto = components['schemas']['CreateRateDto'];
export type UpdateRateDto = components['schemas']['UpdateRateDto'];
export type RateChangesResponseDto =
  components['schemas']['RateChangesResponseDto'];

type RateListQuery = {
  includeInactive?: boolean;
};

type RateChangesQuery = {
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

export function listRates(input: {
  tenantId: string;
  bearer: string;
  query?: RateListQuery;
}): Promise<RateDto[]> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/rates`;
  const path = withQuery(basePath, {
    includeInactive: input.query?.includeInactive,
  });

  return apiRequest<RateDto[]>({
    method: 'GET',
    path,
    bearer: input.bearer,
  });
}

export function pullRateChanges(input: {
  tenantId: string;
  bearer: string;
  query?: RateChangesQuery;
}): Promise<RateChangesResponseDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/rates/changes`;
  const path = withQuery(basePath, {
    afterSeq: input.query?.afterSeq,
    limit: input.query?.limit,
  });

  return apiRequest<RateChangesResponseDto>({
    method: 'GET',
    path,
    bearer: input.bearer,
  });
}

export function createRate(input: {
  tenantId: string;
  bearer: string;
  body: CreateRateDto;
}): Promise<RateDto> {
  return apiRequest<RateDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/rates`,
    body: input.body,
    bearer: input.bearer,
  });
}

export function updateRate(input: {
  tenantId: string;
  rateId: string;
  expectedVersion: number;
  bearer: string;
  body: UpdateRateDto;
}): Promise<RateDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/rates/${encodeURIComponent(input.rateId)}`;
  const path = withQuery(basePath, {
    expectedVersion: input.expectedVersion,
  });

  return apiRequest<RateDto>({
    method: 'PATCH',
    path,
    body: input.body,
    bearer: input.bearer,
  });
}

export function deactivateRate(input: {
  tenantId: string;
  rateId: string;
  expectedVersion: number;
  bearer: string;
}): Promise<void> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/rates/${encodeURIComponent(input.rateId)}`;
  const path = withQuery(basePath, {
    expectedVersion: input.expectedVersion,
  });

  return apiRequest<void>({
    method: 'DELETE',
    path,
    bearer: input.bearer,
  });
}
