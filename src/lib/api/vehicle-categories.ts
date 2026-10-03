import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type VehicleCategoryCode = components['schemas']['VehicleCategory'];
export type VehicleCategoryDto = components['schemas']['VehicleCategoryDto'];

/**
 * Las categorías de la plataforma. Lista cerrada (8 filas), global: no lleva
 * tenant y no tiene feed de cambios, así que el sync la reemplaza entera.
 */
export function listVehicleCategories(input: {
  bearer: string;
}): Promise<VehicleCategoryDto[]> {
  return apiRequest<VehicleCategoryDto[]>({
    method: 'GET',
    path: '/vehicle-categories',
    bearer: input.bearer,
  });
}
