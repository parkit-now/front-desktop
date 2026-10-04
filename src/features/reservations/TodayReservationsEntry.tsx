import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { todaySummary } from './reservationBoard';
import { TodayReservationsDialog } from './TodayReservationsDialog';
import { useReservationActions } from './useReservationActions';
import type { ReservationsFeed } from './useReservationsFeed';

interface Props {
  tenantId: string;
  accessToken: string;
  feed: ReservationsFeed;
  /** Abre la sección Reservas (desde el pie del modal). */
  onOpenReservations?: () => void;
}

/**
 * Ítem "Reservas de hoy" de la pantalla principal (fase 6c). Reemplaza al
 * panel que estaba siempre a la vista: ahora es una tarjeta como la de
 * "Registrar egreso", con un botón que muestra cuántas hay hoy (y cuántas
 * esperan respuesta) y abre el modal con el detalle.
 */
export function TodayReservationsEntry({
  tenantId,
  accessToken,
  feed,
  onOpenReservations,
}: Props) {
  const [open, setOpen] = useState(false);
  const rows = useLiveQuery(
    () => localDb.reservations.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
  const summary = useMemo(() => todaySummary(rows ?? []), [rows]);
  const actions = useReservationActions({ tenantId, accessToken, feed, rows });

  return (
    <section className="exit-controls today-res-entry">
      <h3 className="exit-controls__title">
        <CalendarClock size={18} aria-hidden="true" />
        Reservas
      </h3>
      <button
        type="button"
        className="exit-controls__list-button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="exit-controls__list-icon" aria-hidden="true">
          <CalendarClock size={17} />
        </span>
        <span className="exit-controls__list-label">Reservas de hoy</span>
        {summary.pending > 0 ? (
          <span
            className="today-res-entry__pending"
            aria-label={`${summary.pending} por aceptar`}
          >
            {summary.pending} por aceptar
          </span>
        ) : null}
        <span className="exit-controls__list-count">{summary.today}</span>
      </button>

      {open ? (
        <TodayReservationsDialog
          rows={rows ?? []}
          actions={actions}
          onOpenReservations={
            onOpenReservations
              ? () => {
                  setOpen(false);
                  onOpenReservations();
                }
              : undefined
          }
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}
