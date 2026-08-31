import { apiRequest } from './client';

export interface VehicleCatalogItemDto {
  id: string;
  brand: string;
  model: string;
  type: string | null;
  tenantId: string | null;
  deletedAt: string | null;
  /** Para optimistic locking: se reenvía como `?expectedVersion=N`. */
  version: number;
  syncSeq: number;
  updatedAt: string;
  createdAt: string;
}

export interface VehicleCatalogChangesResponse {
  items: VehicleCatalogItemDto[];
  maxSeq: number;
}

export interface CreateTenantVehicleBody {
  id: string;
  brand: string;
  model: string;
  type?: string;
}

export interface UpdateTenantVehicleBody {
  brand?: string;
  model?: string;
  type?: string;
}

export function pullVehicleCatalog(params: {
  tenantId: string;
  bearer: string;
  query: { afterSeq: number };
}): Promise<VehicleCatalogChangesResponse> {
  const qs = new URLSearchParams({ afterSeq: String(params.query.afterSeq) });
  return apiRequest({
    method: 'GET',
    path: `/tenants/${params.tenantId}/vehicles/catalog?${qs}`,
    bearer: params.bearer,
  });
}

export function createTenantVehicle(params: {
  tenantId: string;
  bearer: string;
  body: CreateTenantVehicleBody;
}): Promise<VehicleCatalogItemDto> {
  return apiRequest({
    method: 'POST',
    path: `/tenants/${params.tenantId}/vehicles`,
    bearer: params.bearer,
    body: params.body,
  });
}

/**
 * El backend exige `expectedVersion`: si no coincide con la versión guardada,
 * responde 409 en vez de pisar el cambio de otra persona. Omitirlo da 400
 * (`forbidNonWhitelisted` está activo en el ValidationPipe global).
 */
export function updateTenantVehicle(params: {
  tenantId: string;
  bearer: string;
  id: string;
  expectedVersion: number;
  body: UpdateTenantVehicleBody;
}): Promise<VehicleCatalogItemDto> {
  const qs = new URLSearchParams({
    expectedVersion: String(params.expectedVersion),
  });
  return apiRequest({
    method: 'PATCH',
    path: `/tenants/${params.tenantId}/vehicles/${params.id}?${qs}`,
    bearer: params.bearer,
    body: params.body,
  });
}

/** Borrado lógico con optimistic locking. Ver `updateTenantVehicle`. */
export function deleteTenantVehicle(params: {
  tenantId: string;
  bearer: string;
  id: string;
  expectedVersion: number;
}): Promise<void> {
  const qs = new URLSearchParams({
    expectedVersion: String(params.expectedVersion),
  });
  return apiRequest({
    method: 'DELETE',
    path: `/tenants/${params.tenantId}/vehicles/${params.id}?${qs}`,
    bearer: params.bearer,
  });
}
