import { formatArs } from '../../lib/format/argentina';
import type { ReservationMatchDto } from '../../lib/api/reservations';
import {
  formatReservationWindow,
  formatTime,
  matchArrivalText,
  upcomingTodayText,
} from './reservationUtils';

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
  // Fase 6c: llega antes de la ventana (dentro del tope) o tarde. Se vincula
  // igual; es un aviso, no frena nada.
  const arrivalText = matchArrivalText(match);
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
      {arrivalText ? (
        <span
          className={`reservation-banner-note reservation-banner-note--${match.arrival}`}
        >
          {arrivalText}
        </span>
      ) : null}
      <span className="reservation-banner-sub">
        Si se pasa de las {formatTime(match.exitAt)}, se cobra el excedente al
        salir.
      </span>
    </div>
  );
}

/**
 * Fase 6c: la patente tiene una reserva HOY, pero llega antes del tope de
 * llegada anticipada. El ingreso de ahora es una estadía común (no se manda
 * la reserva); el aviso es para que el operador se lo diga al conductor.
 */
export function UpcomingReservationNotice({
  upcoming,
}: {
  upcoming: ReservationMatchDto;
}) {
  return (
    <div
      className="reservation-banner reservation-banner--info"
      role="status"
      aria-live="polite"
    >
      <div className="reservation-banner-head">
        <strong>Reserva más tarde · {upcoming.code}</strong>
        <span className="reservation-pill reservation-pill--neutral">
          No se vincula
        </span>
      </div>
      <span className="reservation-banner-sub">
        {upcomingTodayText(upcoming)}
      </span>
    </div>
  );
}
