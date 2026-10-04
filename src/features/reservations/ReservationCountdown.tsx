import { useEffect, useState } from 'react';
import { countdownTo } from './reservationBoard';

/**
 * Cuenta regresiva hasta `approvalDeadlineAt`. Cada instancia tiene su propio
 * reloj de 1 s: son pocas filas (sólo "Por aceptar") y así la tabla entera no
 * se vuelve a dibujar cada segundo.
 */
export function ReservationCountdown({
  deadlineAt,
  prefix = 'Responder en ',
}: {
  deadlineAt: string | undefined;
  prefix?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadlineAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadlineAt]);

  const countdown = countdownTo(deadlineAt, now);
  if (!countdown) return null;
  if (countdown.expired) {
    return (
      <span className="reservation-countdown reservation-countdown--expired">
        Venció el plazo: se rechaza sola
      </span>
    );
  }
  return (
    // Sin aria-live: anunciar cada segundo aturde al lector de pantalla. El
    // `timer` expone el valor a quien lo consulte.
    <span
      role="timer"
      aria-label={`${prefix}${countdown.label}`}
      className={`reservation-countdown${countdown.urgent ? ' reservation-countdown--urgent' : ''}`}
    >
      {prefix}
      <span className="reservation-countdown__value">{countdown.label}</span>
    </span>
  );
}
