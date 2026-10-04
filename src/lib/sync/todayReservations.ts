import {
  listReservations,
  type OwnerReservationDto,
} from '../api/reservations';
import { localDb, type LocalTodayReservation } from '../db/localDb';
import {
  isPanelStatus,
  todayRangeIso,
} from '../../features/entries/reservationUtils';

/** La fila local de "Reservas de hoy" a partir de la del dueño. */
export function toLocalTodayReservation(
  dto: OwnerReservationDto,
  tenantId: string,
  fetchedAt: string,
): LocalTodayReservation {
  return {
    id: dto.id,
    tenantId,
    code: dto.code,
    status: dto.status,
    vehiclePlate: dto.vehiclePlate,
    driverName: dto.driverName ?? undefined,
    entryAt: dto.entryAt,
    exitAt: dto.exitAt,
    totalArs: dto.totalArs,
    // `stay` lo agrega la fase 6; un backend anterior no lo manda.
    enteredAt: dto.stay?.enteredAt ?? undefined,
    fetchedAt,
  };
}

/**
 * Relee las reservas de hoy y reemplaza la foto local de la playa. Sólo las
 * que le importan a la caja (`PANEL_STATUSES`): las que pueden llegar, las que
 * están adentro y las que ya pasaron; ni las sin pagar ni las canceladas.
 *
 * Es una foto y no un feed: se borra lo de la playa y se escribe lo nuevo en
 * la misma transacción, así una reserva cancelada desaparece sola.
 */
export async function refreshTodayReservations(input: {
  tenantId: string;
  bearer: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const { from, to } = todayRangeIso(now);
  const page = await listReservations({
    tenantId: input.tenantId,
    bearer: input.bearer,
    from,
    to,
    pageSize: 100,
  });
  const fetchedAt = now.toISOString();
  const rows = page.items
    .filter((item) => isPanelStatus(item.status))
    .map((item) => toLocalTodayReservation(item, input.tenantId, fetchedAt));

  await localDb.transaction('rw', localDb.todayReservations, async () => {
    await localDb.todayReservations
      .where('tenantId')
      .equals(input.tenantId)
      .delete();
    if (rows.length > 0) await localDb.todayReservations.bulkPut(rows);
  });
}
