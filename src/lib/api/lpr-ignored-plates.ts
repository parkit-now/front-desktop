import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type LprIgnoredPlateDto = components['schemas']['LprIgnoredPlateDto'];
export type CreateLprIgnoredPlateDto =
  components['schemas']['CreateLprIgnoredPlateDto'];
export type UpdateLprIgnoredPlateDto =
  components['schemas']['UpdateLprIgnoredPlateDto'];
type Credentials = { tenantId: string; bearer: string };

function path(tenantId: string, suffix = '') {
  return `/tenants/${encodeURIComponent(tenantId)}/lpr-ignored-plates${suffix}`;
}
export function listLprIgnoredPlates(input: Credentials) {
  return apiRequest<LprIgnoredPlateDto[]>({
    method: 'GET',
    path: path(input.tenantId),
    bearer: input.bearer,
  });
}
export function pullLprIgnoredPlateChanges(
  input: Credentials & { afterSeq: number; limit?: number },
) {
  const query = new URLSearchParams({
    afterSeq: String(input.afterSeq),
    limit: String(input.limit ?? 1000),
  });
  return apiRequest<components['schemas']['LprIgnoredPlateChangesDto']>({
    method: 'GET',
    path: path(input.tenantId, `/changes?${query}`),
    bearer: input.bearer,
  });
}
export function createLprIgnoredPlate(
  input: Credentials & { body: CreateLprIgnoredPlateDto },
) {
  return apiRequest<LprIgnoredPlateDto>({
    method: 'POST',
    path: path(input.tenantId),
    bearer: input.bearer,
    body: input.body,
  });
}
export function updateLprIgnoredPlate(
  input: Credentials & {
    id: string;
    expectedVersion: number;
    body: UpdateLprIgnoredPlateDto;
  },
) {
  return apiRequest<LprIgnoredPlateDto>({
    method: 'PATCH',
    path: path(
      input.tenantId,
      `/${encodeURIComponent(input.id)}?expectedVersion=${input.expectedVersion}`,
    ),
    bearer: input.bearer,
    body: input.body,
  });
}
export function deleteLprIgnoredPlate(
  input: Credentials & { id: string; expectedVersion: number },
) {
  return apiRequest<LprIgnoredPlateDto>({
    method: 'DELETE',
    path: path(
      input.tenantId,
      `/${encodeURIComponent(input.id)}?expectedVersion=${input.expectedVersion}`,
    ),
    bearer: input.bearer,
  });
}
