import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { refreshTodayReservations } from '../../lib/sync/todayReservations';
import {
  formatTime,
  isPanelStatus,
  STATUS_LABELS,
  type ReservationPanelStatus,
} from './reservationUtils';

/** Cada cuánto se relee la lista con la caja abierta y conexión. */
const REFRESH_MS = 60_000;

const STATUS_TONE: Record<ReservationPanelStatus, string> = {
  pending_approval: 'warn',
  confirmed: 'ok',
  checked_in: 'brand',
  completed: 'neutral',
  no_show: 'neutral',
};

interface Props {
  tenantId: string;
  accessToken: string;
}

/**
 * "Reservas de hoy": patente, hora y estado, para que el operador sepa quién
 * viene. Con conexión se relee cada minuto y cada vez que entra o sale un auto
 * (un ingreso vinculado pasa la reserva a "En curso"). Sin conexión muestra la
 * última foto, avisando de cuándo es. Si la playa no tiene reservas hoy, no
 * ocupa lugar en la pantalla.
 */
export function TodayReservationsPanel({ tenantId, accessToken }: Props) {
  const { isOnline } = useNetwork();

  // Cambia con cada ingreso y egreso: dispara la relectura.
  const openEntries = useLiveQuery(
    () =>
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter((e) => !e.leftAt)
        .count(),
    [tenantId],
  );

  useEffect(() => {
    if (!isOnline) return;
    const refresh = () => {
      // La lista es una ayuda: un fallo no se le muestra al operador, la
      // próxima vuelta la reintenta.
      refreshTodayReservations({ tenantId, bearer: accessToken }).catch(
        () => undefined,
      );
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [tenantId, accessToken, isOnline, openEntries]);

  const rows = useLiveQuery(
    () =>
      localDb.todayReservations
        .where('tenantId')
        .equals(tenantId)
        .sortBy('entryAt'),
    [tenantId],
  );

  if (!rows || rows.length === 0) return null;
  const fetchedAt = rows[0]?.fetchedAt;

  return (
    <section className="today-reservations" aria-label="Reservas de hoy">
      <h3 className="today-reservations__title">
        <CalendarClock size={18} aria-hidden="true" />
        Reservas de hoy
      </h3>
      {!isOnline && fetchedAt ? (
        <p className="field-hint field-warning">
          Sin conexión · actualizado a las {formatTime(fetchedAt)}
        </p>
      ) : null}
      <table className="today-reservations__table">
        <thead>
          <tr>
            <th scope="col">Patente</th>
            <th scope="col">Hora</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = isPanelStatus(row.status) ? row.status : null;
            return (
              <tr key={row.id}>
                <td className="today-reservations__plate">
                  {row.vehiclePlate}
                </td>
                <td>
                  {formatTime(row.entryAt)}–{formatTime(row.exitAt)}
                </td>
                <td>
                  {status ? (
                    <span
                      className={`reservation-pill reservation-pill--${STATUS_TONE[status]}`}
                      title={
                        row.enteredAt
                          ? `Ingresó ${formatTime(row.enteredAt)}`
                          : undefined
                      }
                    >
                      {STATUS_LABELS[status]}
                    </span>
                  ) : (
                    row.status
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
