import { useEffect, useMemo, useState } from 'react';
import { WifiOff, X } from 'lucide-react';
import type { LocalReservation } from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useNetwork } from '../../lib/network/NetworkContext';
import { formatTime } from '../entries/reservationUtils';
import {
  categoryLabel,
  useVehicleCategories,
} from '../vehicle-types/vehicleCategories';
import { ReservationCountdown } from './ReservationCountdown';
import {
  actionState,
  formatSlot,
  OFFLINE_ACTIONS_MESSAGE,
  policySummaryLines,
  reservationDetailLines,
  statusChip,
  todayDialogGroups,
} from './reservationBoard';
import type { ReservationActions } from './useReservationActions';

interface Props {
  rows: readonly LocalReservation[];
  actions: ReservationActions;
  /** Abre la sección Reservas completa (y cierra el modal). */
  onOpenReservations?: () => void;
  onClose: () => void;
}

/**
 * Modal "Reservas de hoy" del operativo (fase 6c): se abre desde el ítem de la
 * pantalla principal, igual que "Ver autos en base" abre su tabla. Muestra las
 * por aceptar (con Aceptar / Rechazar, mismas reglas que la sección Reservas:
 * sin conexión no se puede) y las de hoy con su estado ("En curso · llegó
 * antes"); al elegir una se ve el detalle. Lee la foto local.
 */
export function TodayReservationsDialog({
  rows,
  actions,
  onOpenReservations,
  onClose,
}: Props) {
  const { isOnline } = useNetwork();
  const categories = useVehicleCategories();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const nowDate = useMemo(() => new Date(now), [now]);
  const groups = useMemo(
    () => todayDialogGroups(rows, nowDate),
    [rows, nowDate],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const all = [...groups.pending, ...groups.today, ...groups.resolved];
  const selected = all.find((r) => r.id === selectedId) ?? all[0] ?? null;
  const rejectOpen = actions.rejectDialog !== null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Con el diálogo de rechazo abierto, Escape cierra sólo ése.
      if (event.key === 'Escape' && !rejectOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, rejectOpen]);

  const fetchedAt = useMemo(() => {
    const stamps = rows.map((r) => r.fetchedAt).sort();
    return stamps.length > 0 ? stamps[stamps.length - 1] : null;
  }, [rows]);

  function actionButtons(r: LocalReservation) {
    const state = actionState(r, isOnline, now);
    if (state.actions.length === 0) return null;
    const rowBusy = actions.busy?.id === r.id ? actions.busy.action : null;
    return (
      <div className="reservations-actions">
        {state.actions.includes('accept') ? (
          <button
            type="button"
            className="primary-button compact"
            disabled={state.disabled || actions.busy !== null}
            title={state.disabledReason ?? undefined}
            aria-label={`Aceptar la reserva de ${r.vehiclePlate}`}
            onClick={(event) => {
              event.stopPropagation();
              void actions.accept(r);
            }}
          >
            {rowBusy === 'accept' ? 'Aceptando…' : 'Aceptar'}
          </button>
        ) : null}
        {state.actions.includes('reject') ? (
          <button
            type="button"
            className="ghost-button compact danger-button"
            disabled={state.disabled || actions.busy !== null}
            title={state.disabledReason ?? undefined}
            aria-label={`Rechazar la reserva de ${r.vehiclePlate}`}
            onClick={(event) => {
              event.stopPropagation();
              actions.openReject(r);
            }}
          >
            Rechazar
          </button>
        ) : null}
      </div>
    );
  }

  function row(r: LocalReservation, resolved = false) {
    const chip = statusChip(r);
    const isSelected = selected?.id === r.id;
    return (
      <li key={r.id}>
        <div
          className={`today-res-row${isSelected ? ' is-selected' : ''}${resolved ? ' is-resolved' : ''}`}
          data-reservation-id={r.id}
        >
          <button
            type="button"
            className="today-res-row__select"
            aria-pressed={isSelected}
            onClick={() => setSelectedId(r.id)}
          >
            <span className="today-res-row__plate">{r.vehiclePlate}</span>
            <span className="today-res-row__slot">
              {formatSlot(r.entryAt, r.exitAt, nowDate)}
            </span>
            <span className={`reservation-pill reservation-pill--${chip.tone}`}>
              {chip.label}
            </span>
            <span className="today-res-row__paid">
              {formatArs(r.stayPrepaidArs ?? r.totalArs)}
            </span>
          </button>
          {r.status === 'pending_approval' ? (
            <div className="today-res-row__pending">
              <ReservationCountdown deadlineAt={r.approvalDeadlineAt} />
              {actionButtons(r)}
            </div>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <>
      <div
        className="rate-dialog-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !rejectOpen) onClose();
        }}
      >
        <section
          className="rate-dialog today-res-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="today-res-dialog-title"
        >
          <header className="rate-dialog-header">
            <div>
              <p className="rate-dialog-kicker">Reservas</p>
              <h3 id="today-res-dialog-title">Reservas de hoy</h3>
              {fetchedAt ? (
                <p className="muted">
                  Actualizado a las {formatTime(fetchedAt)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="rate-dialog-close"
              onClick={onClose}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </header>

          {!isOnline ? (
            <p
              role="status"
              className="reservations-notice reservations-notice--offline"
            >
              <WifiOff size={16} aria-hidden="true" />
              <span>
                <strong>{OFFLINE_ACTIONS_MESSAGE}</strong> Mostramos lo último
                que vimos.
              </span>
            </p>
          ) : null}

          <div className="today-res-dialog__body">
            <div className="today-res-dialog__list">
              {groups.pending.length > 0 ? (
                <>
                  <h4 className="today-res-dialog__group">
                    Por aceptar · {groups.pending.length}
                  </h4>
                  <ul>{groups.pending.map((r) => row(r))}</ul>
                </>
              ) : null}
              <h4 className="today-res-dialog__group">
                Hoy · vigentes · {groups.today.length}
              </h4>
              {groups.today.length === 0 ? (
                <p className="muted mini">No hay reservas vigentes hoy.</p>
              ) : (
                <ul>{groups.today.map((r) => row(r))}</ul>
              )}
              {groups.resolved.length > 0 ? (
                <>
                  <h4 className="today-res-dialog__group today-res-dialog__group--resolved">
                    Resueltas · {groups.resolved.length}
                  </h4>
                  <ul>{groups.resolved.map((r) => row(r, true))}</ul>
                </>
              ) : null}
            </div>

            <aside
              className="today-res-dialog__detail"
              aria-label="Detalle de la reserva"
            >
              {selected ? (
                <>
                  <div className="today-res-dialog__detail-head">
                    <strong>{selected.vehiclePlate}</strong>
                    <span
                      className={`reservation-pill reservation-pill--${statusChip(selected).tone}`}
                    >
                      {statusChip(selected).label}
                    </span>
                  </div>
                  <dl className="today-res-dialog__dl">
                    {reservationDetailLines(
                      selected,
                      categoryLabel(
                        selected.vehicleCategory as never,
                        categories,
                      ),
                      nowDate,
                    ).map((line) => (
                      <div key={line.label}>
                        <dt>{line.label}</dt>
                        <dd>{line.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {policySummaryLines(selected.policy).length > 0 ? (
                    <ul className="today-res-dialog__policy">
                      {policySummaryLines(selected.policy).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {selected.status === 'pending_approval'
                    ? actionButtons(selected)
                    : null}
                </>
              ) : (
                <p className="muted">Elegí una reserva para ver el detalle.</p>
              )}
            </aside>
          </div>

          {onOpenReservations ? (
            <footer className="today-res-dialog__footer">
              <button
                type="button"
                className="ghost-button compact"
                onClick={onOpenReservations}
              >
                Ver todas en Reservas
              </button>
            </footer>
          ) : null}
        </section>
      </div>
      {actions.rejectDialog}
    </>
  );
}
