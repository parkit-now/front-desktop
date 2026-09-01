import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type VehicleDto = components['schemas']['VehicleDto'];
export type CreateVehicleDto = components['schemas']['CreateVehicleDto'];
export type UpdateVehicleDto = components['schemas']['UpdateVehicleDto'];
export type VehicleChangesResponseDto =
  components['schemas']['VehicleChangesResponseDto'];

type VehicleChangesQuery = {
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

/**
 * Feed de sync del catálogo. A diferencia del listado del ABM, SÍ devuelve las
 * filas borradas (con `deletedAt` no-nulo): el tombstone es la única forma de
 * comunicarle una baja a un cliente offline.
 */
export function pullVehicleChanges(input: {
  tenantId: string;
  bearer: string;
  query?: VehicleChangesQuery;
}): Promise<VehicleChangesResponseDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/vehicles/changes`;
  const path = withQuery(basePath, {
    afterSeq: input.query?.afterSeq,
    limit: input.query?.limit,
  });

  return apiRequest<VehicleChangesResponseDto>({
    method: 'GET',
    path,
    bearer: input.bearer,
  });
}

export function createTenantVehicle(input: {
  tenantId: string;
  bearer: string;
  body: CreateVehicleDto;
}): Promise<VehicleDto> {
  return apiRequest<VehicleDto>({
    method: 'POST',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/vehicles`,
    body: input.body,
    bearer: input.bearer,
  });
}

/**
 * OJO con `expectedVersion`: omitirlo da 400 (`forbidNonWhitelisted` lo exige),
 * no 409. Que no coincida da 409.
 */
export function updateTenantVehicle(input: {
  tenantId: string;
  vehicleId: string;
  expectedVersion: number;
  bearer: string;
  body: UpdateVehicleDto;
}): Promise<VehicleDto> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/vehicles/${encodeURIComponent(input.vehicleId)}`;
  const path = withQuery(basePath, {
    expectedVersion: input.expectedVersion,
  });

  return apiRequest<VehicleDto>({
    method: 'PATCH',
    path,
    body: input.body,
    bearer: input.bearer,
  });
}

/** Borrado LÓGICO: la fila sigue viajando por el feed como tombstone. */
export function deleteTenantVehicle(input: {
  tenantId: string;
  vehicleId: string;
  expectedVersion: number;
  bearer: string;
}): Promise<void> {
  const basePath = `/tenants/${encodeURIComponent(input.tenantId)}/vehicles/${encodeURIComponent(input.vehicleId)}`;
  const path = withQuery(basePath, {
    expectedVersion: input.expectedVersion,
  });

  return apiRequest<void>({
    method: 'DELETE',
    path,
    bearer: input.bearer,
  });
}
