import {
  listAllReservations,
  type OwnerReservationDto,
  type ReservationStatus,
} from '../api/reservations';
import { localDb, type LocalReservation } from '../db/localDb';
import { todayRangeIso } from '../../features/entries/reservationUtils';
import { isBoardStatus } from '../../features/reservations/reservationBoard';

/** La fila local a partir de la del dueño (`OwnerReservationDto` o su detalle). */
export function toLocalReservation(
  dto: OwnerReservationDto,
  tenantId: string,
  fetchedAt: string,
): LocalReservation {
  return {
    id: dto.id,
    tenantId,
    code: dto.code,
    status: dto.status,
    vehiclePlate: dto.vehiclePlate,
    vehicleCategory: dto.vehicleCategory ?? undefined,
    driverName: dto.driverName ?? undefined,
    entryAt: dto.entryAt,
    exitAt: dto.exitAt,
    totalArs: dto.totalArs,
    approvalDeadlineAt: dto.approvalDeadlineAt ?? undefined,
    // Un backend anterior a la fase 3 no manda el reembolso.
    refundStatus: dto.refundStatus ?? 'none',
    refundedAmountArs: dto.refundedAmountArs ?? undefined,
    reason: dto.reason ?? undefined,
    cancelledBy: dto.cancelledBy ?? undefined,
    // `stay` lo agrega la fase 6; un backend anterior no lo manda.
    enteredAt: dto.stay?.enteredAt ?? undefined,
    // `arrival` lo agrega la 6c.
    stayEntryId: dto.stay?.entryId ?? undefined,
    arrival: dto.stay?.arrival ?? undefined,
    minutesEarly: dto.stay?.minutesEarly ?? undefined,
    minutesLate: dto.stay?.minutesLate ?? undefined,
    stayPrepaidArs: dto.stay?.prepaidAmountArs ?? undefined,
    policy: dto.policy ?? undefined,
    fetchedAt,
  };
}

/** Los estados vivos se traen completos, de cualquier fecha. */
const LIVE_STATUSES: readonly ReservationStatus[] = [
  'pending_approval',
  'confirmed',
  'checked_in',
];

/**
 * Lee del servidor todo lo que le importa a la caja:
 * - las vivas (por aceptar, confirmadas y en curso), de cualquier fecha;
 * - las de hoy en cualquier estado (las resueltas hoy van a la pestaña Hoy).
 *
 * El listado filtra por UN estado, así que son cuatro consultas. Una reserva
 * que aparece en dos se queda con una sola fila.
 */
export async function fetchReservations(input: {
  tenantId: string;
  bearer: string;
  now?: Date;
}): Promise<LocalReservation[]> {
  const now = input.now ?? new Date();
  const { from, to } = todayRangeIso(now);
  const auth = { tenantId: input.tenantId, bearer: input.bearer };
  const groups = await Promise.all([
    ...LIVE_STATUSES.map((status) => listAllReservations({ ...auth, status })),
    listAllReservations({ ...auth, from, to }),
  ]);
  const fetchedAt = now.toISOString();
  const byId = new Map<string, LocalReservation>();
  for (const item of groups.flat()) {
    if (!isBoardStatus(item.status)) continue;
    byId.set(item.id, toLocalReservation(item, input.tenantId, fetchedAt));
  }
  return [...byId.values()];
}

/**
 * Reemplaza la foto local de la playa. Es una foto y no un feed: se borra lo
 * de la playa y se escribe lo nuevo en la misma transacción, así una reserva
 * que se resolvió en otro lado desaparece (o cambia de pestaña) sola.
 */
export async function replaceReservations(
  tenantId: string,
  rows: readonly LocalReservation[],
): Promise<void> {
  await localDb.transaction('rw', localDb.reservations, async () => {
    await localDb.reservations.where('tenantId').equals(tenantId).delete();
    if (rows.length > 0) await localDb.reservations.bulkPut([...rows]);
  });
}

/** Lee y reemplaza la foto. Devuelve las filas nuevas. */
export async function refreshReservations(input: {
  tenantId: string;
  bearer: string;
  now?: Date;
}): Promise<LocalReservation[]> {
  const rows = await fetchReservations(input);
  await replaceReservations(input.tenantId, rows);
  return rows;
}

/**
 * Pisa una fila con la respuesta del servidor a una acción (aceptar,
 * rechazar), para que la lista cambie al toque sin esperar la relectura.
 */
export async function applyReservationResult(
  dto: OwnerReservationDto,
  tenantId: string,
): Promise<void> {
  await localDb.reservations.put(
    toLocalReservation(dto, tenantId, new Date().toISOString()),
  );
}
