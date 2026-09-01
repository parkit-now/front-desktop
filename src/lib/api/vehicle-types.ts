import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type VehicleTypeDto = components['schemas']['VehicleTypeDto'];
export type VehicleTypeListItemDto =
  components['schemas']['VehicleTypeListItemDto'];
export type CreateVehicleTypeDto =
  components['schemas']['CreateVehicleTypeDto'];
export type UpdateVehicleTypeDto =
  components['schemas']['UpdateVehicleTypeDto'];
export type VehicleTypeChangesResponseDto =
  components['schemas']['VehicleTypeChangesResponseDto'];
export type DeleteVehicleTypeResultDto =
  components['schemas']['DeleteVehicleTypeResultDto'];

type VehicleTypeChangesQuery = {
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

/** Feed de sync de tipos. Incluye los borrados, como tombstones. */
export function pullVehicleTypeChanges(input: {
  tenantId: string;
  bearer: string;
  query?: VehicleTypeChangesQuery;
}): Promise<VehicleTypeChangesResponseDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/vehicle-types/changes`;
  const path = withQuery(basePath, {
    afterSeq: input.query?.afterSeq,
    limit: input.query?.limit,
  });

  return apiRequest<VehicleTypeChangesResponseDto>({
    method: 'GET',
    path,
    bearer: input.bearer,
  });
}

export function createVehicleType(input: {
  tenantId: string;
  bearer: string;
  body: CreateVehicleTypeDto;
}): Promise<VehicleTypeDto> {
  return apiRequest<VehicleTypeDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/vehicle-types`,
    body: input.body,
    bearer: input.bearer,
  });
}

export function updateVehicleType(input: {
  tenantId: string;
  typeId: string;
  expectedVersion: number;
  bearer: string;
  body: UpdateVehicleTypeDto;
}): Promise<VehicleTypeDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/vehicle-types/${encodeURIComponent(input.typeId)}`;
  const path = withQuery(basePath, {
    expectedVersion: input.expectedVersion,
  });

  return apiRequest<VehicleTypeDto>({
    method: 'PATCH',
    path,
    body: input.body,
    bearer: input.bearer,
  });
}

/**
 * Borrado lógico. Si quedan vehículos usando el tipo hay que mandar
 * `reassignToTypeId`; sin eso responde 409 `VEHICLE_TYPE_IN_USE`.
 */
export function deleteVehicleType(input: {
  tenantId: string;
  typeId: string;
  expectedVersion: number;
  bearer: string;
  reassignToTypeId?: string;
}): Promise<DeleteVehicleTypeResultDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/vehicle-types/${encodeURIComponent(input.typeId)}`;
  const path = withQuery(basePath, {
    expectedVersion: input.expectedVersion,
    reassignToTypeId: input.reassignToTypeId,
  });

  return apiRequest<DeleteVehicleTypeResultDto>({
    method: 'DELETE',
    path,
    bearer: input.bearer,
  });
}
