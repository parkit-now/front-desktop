import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type ReservationMatchDto = components['schemas']['ReservationMatchDto'];
export type ReservationMatchResponseDto =
  components['schemas']['ReservationMatchResponseDto'];
export type OwnerReservationDto = components['schemas']['OwnerReservationDto'];
export type PaginatedOwnerReservationsDto =
  components['schemas']['PaginatedOwnerReservationsDto'];

/**
 * La reserva confirmada de esa patente dentro de su ventana de llegada, o
 * `null`. Es la misma regla con la que el backend vincula el ingreso, así que
 * lo que muestra el banner es lo que se vincula.
 */
export function matchReservation(input: {
  tenantId: string;
  bearer: string;
  plate: string;
}): Promise<ReservationMatchResponseDto> {
  const params = new URLSearchParams({ plate: input.plate });
  return apiRequest<ReservationMatchResponseDto>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/reservations/match?${params.toString()}`,
    bearer: input.bearer,
  });
}

/** Reservas de la playa cuyo ingreso cae entre `from` y `to` (inclusive). */
export function listReservations(input: {
  tenantId: string;
  bearer: string;
  from: string;
  to: string;
  pageSize?: number;
}): Promise<PaginatedOwnerReservationsDto> {
  const params = new URLSearchParams({
    from: input.from,
    to: input.to,
    pageSize: String(input.pageSize ?? 100),
  });
  return apiRequest<PaginatedOwnerReservationsDto>({
    method: 'GET',
    path: `/tenants/${encodeURIComponent(input.tenantId)}/reservations?${params.toString()}`,
    bearer: input.bearer,
  });
}
