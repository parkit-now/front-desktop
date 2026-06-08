import { apiRequest } from './client';

export interface VehicleCatalogItemDto {
  id: string;
  brand: string;
  model: string;
  type: string | null;
  tenantId: string | null;
  deletedAt: string | null;
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

export function updateTenantVehicle(params: {
  tenantId: string;
  bearer: string;
  id: string;
  body: UpdateTenantVehicleBody;
}): Promise<VehicleCatalogItemDto> {
  return apiRequest({
    method: 'PATCH',
    path: `/tenants/${params.tenantId}/vehicles/${params.id}`,
    bearer: params.bearer,
    body: params.body,
  });
}

export function deleteTenantVehicle(params: {
  tenantId: string;
  bearer: string;
  id: string;
}): Promise<void> {
  return apiRequest({
    method: 'DELETE',
    path: `/tenants/${params.tenantId}/vehicles/${params.id}`,
    bearer: params.bearer,
  });
}
