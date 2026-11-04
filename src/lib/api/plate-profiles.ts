import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type PlateProfileDto = components['schemas']['PlateProfileDto'];
export type CreatePlateProfileDto =
  components['schemas']['CreatePlateProfileDto'];
export type UpdatePlateProfileDto =
  components['schemas']['UpdatePlateProfileDto'];
export type DeletePlateProfileDto =
  components['schemas']['DeletePlateProfileDto'];
type Credentials = { tenantId: string; bearer: string };
const path = (tenantId: string, suffix = '') =>
  `/tenants/${encodeURIComponent(tenantId)}/plate-profiles${suffix}`;

export function pullPlateProfileChanges(
  input: Credentials & { afterSeq: number },
) {
  return apiRequest<components['schemas']['PlateProfileChangesDto']>({
    method: 'GET',
    path: path(input.tenantId, `/changes?afterSeq=${input.afterSeq}`),
    bearer: input.bearer,
  });
}
export function listPlateProfiles(input: Credentials) {
  return apiRequest<PlateProfileDto[]>({
    method: 'GET',
    path: path(input.tenantId),
    bearer: input.bearer,
  });
}
export function getPlateProfile(input: Credentials & { plate: string }) {
  return apiRequest<PlateProfileDto>({
    method: 'GET',
    path: path(input.tenantId, `/${encodeURIComponent(input.plate)}`),
    bearer: input.bearer,
  });
}
export function writePlateProfile(
  input: Credentials & {
    plate: string;
    operation: 'create' | 'update' | 'delete';
    body: UpdatePlateProfileDto;
  },
) {
  return apiRequest<PlateProfileDto>({
    method:
      input.operation === 'create'
        ? 'POST'
        : input.operation === 'update'
          ? 'PATCH'
          : 'DELETE',
    path: path(
      input.tenantId,
      input.operation === 'create' ? '' : `/${encodeURIComponent(input.plate)}`,
    ),
    bearer: input.bearer,
    body:
      input.operation === 'create'
        ? { ...input.body, plate: input.plate }
        : input.operation === 'delete'
          ? {
              mutationId: input.body.mutationId,
              expectedVersion: input.body.expectedVersion,
              occurredAt: input.body.occurredAt,
            }
          : input.body,
  });
}
