import { useEffect, useId, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, RefreshCw, WifiOff } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { useNetwork } from '../../lib/network/NetworkContext';
import { formatTime } from '../entries/reservationUtils';
import { ReservationCountdown } from './ReservationCountdown';
import { useReservationActions } from './useReservationActions';
import {
  actionState,
  BUCKET_LABELS,
  BUCKETS,
  countByBucket,
  countdownTo,
  formatSlot,
  OFFLINE_ACTIONS_MESSAGE,
  reasonLabel,
  refundChip,
  rowsOf,
  statusChip,
  type ReservationBucket,
} from './reservationBoard';
import type { ReservationsFeed } from './useReservationsFeed';

const EMPTY_COPY: Record<ReservationBucket, { title: string; hint: string }> = {
  pending: {
    title: 'No hay reservas por aceptar',
    hint: 'Cuando un conductor pague una reserva, aparece acá para aceptarla o rechazarla.',
  },
  today: {
    title: 'No hay reservas para hoy',
    hint: 'Las reservas confirmadas de hoy y las que ya están adentro aparecen acá.',
  },
  upcoming: {
    title: 'No hay reservas próximas',
    hint: 'Las reservas confirmadas de mañana en adelante aparecen acá.',
  },
};

interface Props {
  tenantId: string;
  accessToken: string;
  feed: ReservationsFeed;
}

/**
 * Sección "Reservas" de la caja: el dueño o el operador ven las reservas de la
 * playa y aceptan o rechazan las que esperan respuesta, con el mismo criterio
 * que la pantalla del dueño en la web.
 *
 * Lee SIEMPRE de la foto local (`localDb.reservations`), que mantiene al día
 * `useReservationsFeed`. Sin conexión se ve la última foto, sólo lectura:
 * aceptar y rechazar no se encolan (mueven plata y tienen plazo).
 */
export function ReservationsPanel({ tenantId, accessToken, feed }: Props) {
  const { isOnline } = useNetwork();
  const ids = useId();
  const offlineNoteId = `${ids}-offline`;

  const rows = useLiveQuery(
    () => localDb.reservations.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  // Las pestañas sólo dependen de la hora de a minuto ("Hoy" cambia a las 0 h).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const nowDate = useMemo(() => new Date(now), [now]);

  const counts = useMemo(
    () => countByBucket(rows ?? [], nowDate),
    [rows, nowDate],
  );

  const [tab, setTab] = useState<ReservationBucket | null>(null);
  // Con reservas por aceptar se abre en esa pestaña; si no, en Hoy. Se decide
  // una vez, cuando se conocen los datos (también al cambiar de playa).
  useEffect(() => {
    setTab(null);
  }, [tenantId]);
  useEffect(() => {
    if (tab !== null || rows === undefined) return;
    setTab(counts.pending > 0 ? 'pending' : 'today');
  }, [tab, rows, counts.pending]);
  const activeTab: ReservationBucket = tab ?? 'pending';

  const visible = useMemo(
    () => rowsOf(rows ?? [], activeTab, nowDate),
    [rows, activeTab, nowDate],
  );

  const fetchedAt = useMemo(() => {
    const stamps = (rows ?? []).map((r) => r.fetchedAt).sort();
    return stamps.length > 0 ? stamps[stamps.length - 1] : null;
  }, [rows]);

  const mostUrgent = useMemo(
    () =>
      rowsOf(rows ?? [], 'pending', nowDate).find(
        (r) => !countdownTo(r.approvalDeadlineAt, now)?.expired,
      ) ?? null,
    [rows, nowDate, now],
  );

  const { busy, accept, openReject, rejectDialog } = useReservationActions({
    tenantId,
    accessToken,
    feed,
    rows,
  });

  return (
    <div className="reservations-panel">
      <section
        className="dashboard-card reservations-card"
        aria-labelledby={`${ids}-title`}
      >
        <div className="reservations-head">
          <div>
            <h2 id={`${ids}-title`} className="reservations-title">
              <CalendarClock size={20} aria-hidden="true" />
              Reservas de la playa
            </h2>
            <p className="muted">
              Aceptá o rechazá las reservas pagas. Si nadie responde a tiempo,
              se rechazan solas y se le devuelve todo al conductor.
            </p>
          </div>
          <div className="reservations-meta">
            {fetchedAt ? (
              <span className="muted mini">
                Actualizado {formatTime(fetchedAt)}
              </span>
            ) : null}
            <button
              type="button"
              className="ghost-button compact reservations-refresh"
              onClick={() => void feed.refresh()}
              disabled={!isOnline || feed.refreshing}
              aria-describedby={!isOnline ? offlineNoteId : undefined}
            >
              <RefreshCw
                size={15}
                aria-hidden="true"
                className={feed.refreshing ? 'is-spinning' : undefined}
              />
              {feed.refreshing ? 'Actualizando…' : 'Actualizar'}
            </button>
          </div>
        </div>

        {!isOnline ? (
          <p
            id={offlineNoteId}
            role="status"
            className="reservations-notice reservations-notice--offline"
          >
            <WifiOff size={16} aria-hidden="true" />
            <span>
              <strong>{OFFLINE_ACTIONS_MESSAGE}</strong>{' '}
              {fetchedAt
                ? `Mostramos lo último que vimos, a las ${formatTime(fetchedAt)}.`
                : 'Todavía no hay datos guardados en este equipo.'}
            </span>
          </p>
        ) : feed.failed ? (
          <p role="status" className="reservations-notice">
            No pudimos actualizar las reservas. Reintentamos en unos segundos.
          </p>
        ) : null}

        {counts.pending > 0 && activeTab !== 'pending' ? (
          <div className="reservations-notice reservations-notice--warn">
            <span>
              {counts.pending === 1
                ? 'Hay 1 reserva por aceptar.'
                : `Hay ${counts.pending} reservas por aceptar.`}{' '}
              {mostUrgent ? (
                <ReservationCountdown
                  deadlineAt={mostUrgent.approvalDeadlineAt}
                  prefix="La más urgente vence en "
                />
              ) : null}
            </span>
            <button
              type="button"
              className="ghost-button compact"
              onClick={() => setTab('pending')}
            >
              Ver
            </button>
          </div>
        ) : null}

        <div
          className="printer-template-tabs reservations-tabs"
          role="tablist"
          aria-label="Reservas"
        >
          {BUCKETS.map((bucket) => (
            <button
              key={bucket}
              type="button"
              role="tab"
              id={`${ids}-tab-${bucket}`}
              aria-selected={activeTab === bucket}
              aria-controls={`${ids}-tabpanel`}
              className={activeTab === bucket ? 'active' : ''}
              onClick={() => setTab(bucket)}
            >
              {BUCKET_LABELS[bucket]}
              <span
                className={`reservations-tab-count${
                  bucket === 'pending' && counts[bucket] > 0
                    ? ' reservations-tab-count--warn'
                    : ''
                }`}
              >
                {counts[bucket]}
              </span>
            </button>
          ))}
        </div>

        <div
          id={`${ids}-tabpanel`}
          role="tabpanel"
          aria-labelledby={`${ids}-tab-${activeTab}`}
        >
          {rows === undefined ? (
            <p className="muted">Cargando reservas…</p>
          ) : visible.length === 0 ? (
            <div className="reservations-empty">
              <strong>{EMPTY_COPY[activeTab].title}</strong>
              <p className="muted">{EMPTY_COPY[activeTab].hint}</p>
            </div>
          ) : (
            <table className="reservations-table">
              <thead>
                <tr>
                  <th scope="col">Patente</th>
                  <th scope="col">Conductor</th>
                  <th scope="col">Franja</th>
                  <th scope="col">Monto</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Reembolso</th>
                  {activeTab === 'pending' ? (
                    <th scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const chip = statusChip(r);
                  const refund = refundChip(r);
                  const reason = reasonLabel(r);
                  const state = actionState(r, isOnline, now);
                  const rowBusy = busy?.id === r.id ? busy.action : null;
                  return (
                    <tr key={r.id} data-reservation-id={r.id}>
                      <td>
                        <span className="reservations-plate">
                          {r.vehiclePlate}
                        </span>
                        <span className="reservations-code">{r.code}</span>
                      </td>
                      <td>{r.driverName ?? '—'}</td>
                      <td>{formatSlot(r.entryAt, r.exitAt, nowDate)}</td>
                      <td>{formatArs(r.totalArs)}</td>
                      <td>
                        <div className="reservations-status">
                          <span
                            className={`reservation-pill reservation-pill--${chip.tone}`}
                            title={
                              r.enteredAt
                                ? `Ingresó ${formatTime(r.enteredAt)}`
                                : undefined
                            }
                          >
                            {chip.label}
                          </span>
                          {r.status === 'pending_approval' ? (
                            <ReservationCountdown
                              deadlineAt={r.approvalDeadlineAt}
                            />
                          ) : reason ? (
                            <span className="reservations-reason">
                              {reason}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {refund ? (
                          <span
                            className={`reservation-pill reservation-pill--${refund.tone}`}
                          >
                            {refund.label}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      {activeTab === 'pending' ? (
                        <td>
                          <div className="reservations-actions">
                            {state.actions.includes('accept') ? (
                              <button
                                type="button"
                                className="primary-button compact"
                                disabled={state.disabled || busy !== null}
                                aria-describedby={
                                  state.disabled ? offlineNoteId : undefined
                                }
                                aria-label={`Aceptar la reserva de ${r.vehiclePlate}`}
                                onClick={() => void accept(r)}
                              >
                                {rowBusy === 'accept'
                                  ? 'Aceptando…'
                                  : 'Aceptar'}
                              </button>
                            ) : null}
                            {state.actions.includes('reject') ? (
                              <button
                                type="button"
                                className="ghost-button compact danger-button"
                                disabled={state.disabled || busy !== null}
                                aria-describedby={
                                  state.disabled ? offlineNoteId : undefined
                                }
                                aria-label={`Rechazar la reserva de ${r.vehiclePlate}`}
                                onClick={() => openReject(r)}
                              >
                                Rechazar
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {rejectDialog}
    </div>
  );
}
