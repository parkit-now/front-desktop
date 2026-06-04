import { apiRequest } from './client';

export interface VehicleDto {
  id: string;
  brand: string;
  model: string;
  type?: string | null;
}

export interface CreateVehicleDto {
  id: string;
  brand: string;
  model: string;
  type?: string;
}

export function createVehicle(input: {
  bearer: string;
  body: CreateVehicleDto;
}): Promise<VehicleDto> {
  return apiRequest<VehicleDto>({
    method: 'POST',
    path: '/vehicles',
    body: input.body,
    bearer: input.bearer,
  });
}
