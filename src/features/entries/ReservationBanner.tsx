import { formatArs } from '../../lib/format/argentina';
import type { ReservationMatchDto } from '../../lib/api/reservations';
import { formatReservationWindow, formatTime } from './reservationUtils';

/**
 * Banner del ingreso: la patente tiene una reserva confirmada dentro de su
 * ventana de llegada. El operador no hace nada distinto: registra el ingreso
 * como siempre y queda vinculado.
 */
export function EntryReservationBanner({
  match,
}: {
  match: ReservationMatchDto;
}) {
  const paid = match.prepaidAmountArs > 0;
  return (
    <div className="reservation-banner" role="status" aria-live="polite">
      <div className="reservation-banner-head">
        <strong>Tiene reserva · {match.code}</strong>
        <span
          className={`reservation-pill ${paid ? 'reservation-pill--ok' : 'reservation-pill--warn'}`}
        >
          {paid ? 'Pagada' : 'Sin pago registrado'}
        </span>
      </div>
      <span className="reservation-banner-sub">
        {formatReservationWindow(match.entryAt, match.exitAt)}
        {paid ? ` · ${formatArs(match.prepaidAmountArs)} por Mercado Pago` : ''}
      </span>
      <span className="reservation-banner-sub">
        Si se pasa de las {formatTime(match.exitAt)}, se cobra el excedente al
        salir.
      </span>
    </div>
  );
}
