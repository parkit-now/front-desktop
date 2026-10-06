import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type ServiceCatalogItemDto =
  components['schemas']['ServiceCatalogItemDto'];

export function listServices(input: {
  tenantId: string;
  bearer: string;
}): Promise<ServiceCatalogItemDto[]> {
  return apiRequest<ServiceCatalogItemDto[]>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/services`,
    bearer: input.bearer,
  });
}
