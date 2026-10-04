import type { components } from '../../generated/api-types';
import { apiRequest } from './client';

export type ReservationMatchDto = components['schemas']['ReservationMatchDto'];
export type ReservationMatchResponseDto =
  components['schemas']['ReservationMatchResponseDto'];
export type OwnerReservationDto = components['schemas']['OwnerReservationDto'];
export type PaginatedOwnerReservationsDto =
  components['schemas']['PaginatedOwnerReservationsDto'];
export type OwnerReservationDetailDto =
  components['schemas']['OwnerReservationDetailDto'];
export type ReservationStatus = components['schemas']['ReservationStatus'];

/** Tope de página del backend: pedir más devuelve 400. */
export const RESERVATIONS_PAGE_SIZE = 100;

const base = (tenantId: string) =>
  `/tenants/${encodeURIComponent(tenantId)}/reservations`;

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
    path: `${base(input.tenantId)}/match?${params.toString()}`,
    bearer: input.bearer,
  });
}

/**
 * Una página de reservas de la playa. Filtra por UN `status` (el backend no
 * acepta varios) y/o por `entryAt` entre `from` y `to` (inclusive). Ordena por
 * `entryAt` descendente.
 */
export function listReservations(input: {
  tenantId: string;
  bearer: string;
  status?: ReservationStatus;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedOwnerReservationsDto> {
  const params = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? RESERVATIONS_PAGE_SIZE),
  });
  if (input.status) params.set('status', input.status);
  if (input.from) params.set('from', input.from);
  if (input.to) params.set('to', input.to);
  return apiRequest<PaginatedOwnerReservationsDto>({
    method: 'GET',
    path: `${base(input.tenantId)}?${params.toString()}`,
    bearer: input.bearer,
  });
}

/**
 * Todas las páginas de un filtro, hasta `maxItems`. Las reservas vivas se
 * traen completas: una confirmada para dentro de una semana no puede quedar
 * afuera por paginar.
 */
export async function listAllReservations(
  input: Omit<Parameters<typeof listReservations>[0], 'page' | 'pageSize'>,
  maxItems = 500,
): Promise<OwnerReservationDto[]> {
  const all: OwnerReservationDto[] = [];
  let page = 1;
  while (all.length < maxItems) {
    const res = await listReservations({
      ...input,
      page,
      pageSize: RESERVATIONS_PAGE_SIZE,
    });
    all.push(...res.items);
    if (all.length >= res.total || res.items.length === 0) break;
    page += 1;
  }
  return all;
}

/**
 * POST …/accept — sólo `pending_approval` y dentro del plazo. Lo pueden hacer
 * el dueño y el operador (el backend no restringe por rol).
 */
export function acceptReservation(input: {
  tenantId: string;
  bearer: string;
  reservationId: string;
}): Promise<OwnerReservationDetailDto> {
  return apiRequest<OwnerReservationDetailDto>({
    method: 'POST',
    path: `${base(input.tenantId)}/${encodeURIComponent(input.reservationId)}/accept`,
    bearer: input.bearer,
  });
}

/** POST …/reject — motivo obligatorio (lo ve el conductor); reembolso total. */
export function rejectReservation(input: {
  tenantId: string;
  bearer: string;
  reservationId: string;
  reason: string;
}): Promise<OwnerReservationDetailDto> {
  return apiRequest<OwnerReservationDetailDto>({
    method: 'POST',
    path: `${base(input.tenantId)}/${encodeURIComponent(input.reservationId)}/reject`,
    body: { reason: input.reason },
    bearer: input.bearer,
  });
}
