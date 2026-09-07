import { useLiveQuery } from 'dexie-react-hooks';
import {
  Banknote,
  Car,
  Clock,
  CreditCard,
  Receipt,
  Timer,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import { useMemo } from 'react';
import { localDb, type LocalCashSession } from '../../lib/db/localDb';
import { formatArs } from '../../lib/format/argentina';
import { formatMinutes } from '../entries/entryUtils';
import { CashSessionNotesEditor } from './CashSessionNotesEditor';
import { computeSessionStats, pmShare } from './cashSessionUtils';

interface Props {
  session: LocalCashSession;
  /** When provided, the notes section becomes editable. */
  onSaveNotes?: (notes: string) => Promise<void>;
}

export function CashSessionStats({ session, onSaveNotes }: Props) {
  const transactions = useLiveQuery(
    () =>
      localDb.paymentTransactions
        .where('cashSessionId')
        .equals(session.id)
        .toArray(),
    [session.id],
  );

  const entries = useLiveQuery(
    () => localDb.entries.where('cashSessionId').equals(session.id).toArray(),
    [session.id],
  );

  const stats = useMemo(
    () => computeSessionStats(session, entries ?? [], transactions ?? []),
    [session, entries, transactions],
  );

  if (transactions === undefined || entries === undefined) {
    return <p className="muted">Calculando resumen del turno...</p>;
  }

  const { summary } = stats;
  const isClosed = Boolean(session.closedAt);

  return (
    <div className="csd-body">
      <div className="csd-hero">
        <div className="csd-hero-main">
          <span className="csd-hero-label">Total recaudado</span>
          <span className="csd-hero-value">
            {formatArs(summary.grandTotal)}
          </span>
        </div>
        <div className="csd-hero-aside">
          <span className="csd-hero-aside-label">
            <Wallet size={14} aria-hidden="true" />
            Efectivo en caja
          </span>
          <span className="csd-hero-aside-value">
            {formatArs(summary.cashTotal)}
          </span>
        </div>
      </div>

      <div className="csd-section">
        <div className="csd-stats">
          <div className="csd-stat">
            <span className="csd-stat-icon">
              <Car size={15} aria-hidden="true" />
            </span>
            <span className="csd-stat-label">Vehículos</span>
            <span className="csd-stat-value">{stats.vehicleCount}</span>
          </div>
          <div className="csd-stat">
            <span className="csd-stat-icon">
              <Receipt size={15} aria-hidden="true" />
            </span>
            <span className="csd-stat-label">Ticket promedio</span>
            <span className="csd-stat-value">
              {stats.averageTicket != null
                ? formatArs(stats.averageTicket)
                : '—'}
            </span>
          </div>
          <div className="csd-stat">
            <span className="csd-stat-icon">
              <Timer size={15} aria-hidden="true" />
            </span>
            <span className="csd-stat-label">Estadía promedio</span>
            <span className="csd-stat-value">
              {stats.averageStayMinutes != null
                ? formatMinutes(stats.averageStayMinutes)
                : '—'}
            </span>
          </div>
          <div className="csd-stat">
            <span className="csd-stat-icon">
              <Clock size={15} aria-hidden="true" />
            </span>
            <span className="csd-stat-label">
              {isClosed ? 'Duración del turno' : 'Turno en curso'}
            </span>
            <span className="csd-stat-value">
              {stats.shiftDurationMinutes != null
                ? formatMinutes(stats.shiftDurationMinutes)
                : '—'}
            </span>
          </div>
        </div>
        {stats.topRate ? (
          <p className="csd-stat-footnote">
            Tarifa más usada: <strong>{stats.topRate.name}</strong> (
            {stats.topRate.count})
          </p>
        ) : null}
      </div>

      <div className="csd-section">
        <h4 className="csd-section-title">Cobros por medio de pago</h4>
        {summary.byPm.length === 0 ? (
          <p className="muted">Sin cobros registrados en este turno.</p>
        ) : (
          <ul className="csd-pm-list">
            {summary.byPm.map((pm) => {
              const share = pmShare(pm.total, summary.grandTotal);
              return (
                <li className="csd-pm-row" key={pm.pmId}>
                  <div className="csd-pm-top">
                    <span className="csd-pm-name">
                      {pm.isCash ? (
                        <Banknote size={15} aria-hidden="true" />
                      ) : (
                        <CreditCard size={15} aria-hidden="true" />
                      )}
                      {pm.pmName}
                    </span>
                    <span className="csd-pm-amounts">
                      {formatArs(pm.total)}
                      <span className="csd-pm-share">
                        {Math.round(share * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="csd-pm-bar">
                    <div
                      className="csd-pm-bar-fill"
                      data-cash={pm.isCash || undefined}
                      style={{ width: `${share * 100}%` }}
                    />
                  </div>
                  <span className="csd-pm-count">
                    {pm.count} {pm.count === 1 ? 'cobro' : 'cobros'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="csd-section">
        <h4 className="csd-section-title">Arqueo de efectivo</h4>
        <dl className="csd-recon">
          <div className="csd-recon-row">
            <dt>Fondo inicial</dt>
            <dd>{formatArs(summary.openingCash)}</dd>
          </div>
          <div className="csd-recon-row">
            <dt>Cobrado en efectivo</dt>
            <dd>+ {formatArs(summary.cashCollected)}</dd>
          </div>
          <div className="csd-recon-row csd-recon-row--total">
            <dt>Efectivo esperado</dt>
            <dd>{formatArs(summary.cashTotal)}</dd>
          </div>
          {isClosed ? (
            <div className="csd-recon-row">
              <dt>Fondo dejado al siguiente turno</dt>
              <dd>
                {session.leavingCash != null
                  ? formatArs(session.leavingCash)
                  : '—'}
              </dd>
            </div>
          ) : null}
          {isClosed && stats.withdrawnCash != null ? (
            <div className="csd-recon-row">
              <dt>Retirado</dt>
              <dd>{formatArs(stats.withdrawnCash)}</dd>
            </div>
          ) : null}
        </dl>
        {stats.handoffStatus === 'over' ? (
          <p className="csd-note csd-note--warning">
            <TriangleAlert size={15} aria-hidden="true" />
            El fondo dejado supera el efectivo esperado. Revisá el cierre.
          </p>
        ) : null}
      </div>

      {isClosed && summary.txCount === 0 && stats.vehicleCount > 0 ? (
        <p className="csd-note csd-note--warning">
          <TriangleAlert size={15} aria-hidden="true" />
          Esta caja no tiene cobros registrados localmente. Puede que falte
          sincronizar.
        </p>
      ) : null}

      {isClosed && stats.vehiclesStillParked > 0 ? (
        <p className="csd-note csd-note--warning">
          <TriangleAlert size={15} aria-hidden="true" />
          {stats.vehiclesStillParked}{' '}
          {stats.vehiclesStillParked === 1 ? 'vehículo' : 'vehículos'}{' '}
          {stats.vehiclesStillParked === 1 ? 'sigue' : 'siguen'} marcado
          {stats.vehiclesStillParked === 1 ? '' : 's'} como estacionado
          {stats.vehiclesStillParked === 1 ? '' : 's'} en esta caja.
        </p>
      ) : null}

      {onSaveNotes ? (
        <CashSessionNotesEditor
          notes={session.notes ?? ''}
          onSave={onSaveNotes}
        />
      ) : session.notes ? (
        <div className="csd-section">
          <h4 className="csd-section-title">Notas del turno</h4>
          <p className="csd-notes">{session.notes}</p>
        </div>
      ) : null}
    </div>
  );
}
