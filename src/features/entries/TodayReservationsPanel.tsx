import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import {
  arDayKey,
  arrivalSuffix,
  formatTime,
  isPanelStatus,
  STATUS_LABELS,
  type ReservationPanelStatus,
} from './reservationUtils';

const STATUS_TONE: Record<ReservationPanelStatus, string> = {
  pending_approval: 'warn',
  confirmed: 'ok',
  checked_in: 'brand',
  completed: 'neutral',
  no_show: 'neutral',
};

interface Props {
  tenantId: string;
  /** Por aceptar y a tiempo (el mismo número que el badge del menú). */
  pendingCount: number;
  /** Abre la sección Reservas (sin esto, el panel no ofrece el link). */
  onOpenReservations?: () => void;
}

/**
 * "Reservas de hoy": patente, hora y estado, para que el operador sepa quién
 * viene. Es un resumen de la sección Reservas: lee la misma foto local, que
 * mantiene al día `useReservationsFeed` (con conexión, cada 15 s y con cada
 * ingreso o egreso). Sin conexión muestra la última foto, avisando de cuándo
 * es. Si la playa no tiene nada hoy ni por aceptar, no ocupa lugar.
 */
export function TodayReservationsPanel({
  tenantId,
  pendingCount,
  onOpenReservations,
}: Props) {
  const { isOnline } = useNetwork();

  const rows = useLiveQuery(async () => {
    const today = arDayKey();
    const all = await localDb.reservations
      .where('tenantId')
      .equals(tenantId)
      .toArray();
    return all
      .filter(
        (r) =>
          isPanelStatus(r.status) &&
          r.status !== 'pending_approval' &&
          (r.status === 'checked_in' || arDayKey(r.entryAt) === today),
      )
      .sort((a, b) => a.entryAt.localeCompare(b.entryAt));
  }, [tenantId]);

  if (!rows || (rows.length === 0 && pendingCount === 0)) return null;
  const fetchedAt = rows[0]?.fetchedAt;

  return (
    <section className="today-reservations" aria-label="Reservas de hoy">
      <div className="today-reservations__head">
        <h3 className="today-reservations__title">
          <CalendarClock size={18} aria-hidden="true" />
          Reservas de hoy
        </h3>
        {onOpenReservations ? (
          <button
            type="button"
            className="link-button"
            onClick={onOpenReservations}
          >
            {pendingCount > 0
              ? `${pendingCount} por aceptar · Ver`
              : 'Ver reservas'}
          </button>
        ) : null}
      </div>
      {!isOnline && fetchedAt ? (
        <p className="field-hint field-warning">
          Sin conexión · actualizado a las {formatTime(fetchedAt)}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="muted mini">No hay reservas confirmadas para hoy.</p>
      ) : (
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
                        {status === 'checked_in' && arrivalSuffix(row.arrival)
                          ? ` · ${arrivalSuffix(row.arrival)}`
                          : ''}
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
      )}
    </section>
  );
}
