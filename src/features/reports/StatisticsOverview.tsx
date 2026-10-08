import type { MetricsSummary, Revenue } from '../../lib/api/reports';
import { money } from './reportUtils';

type Props = {
  summary?: MetricsSummary;
  month?: Revenue;
  summaryLoading: boolean;
  monthLoading: boolean;
  monthError: boolean;
};

function LoadingValue() {
  return (
    <span
      className="report-skeleton report-overview-loading-value"
      aria-hidden="true"
    />
  );
}

function Projection({
  label,
  value,
  detail,
  loading,
  emphasized = false,
}: {
  label: string;
  value: string;
  detail: string;
  loading: boolean;
  emphasized?: boolean;
}) {
  return (
    <div
      className={`report-overview-projection${emphasized ? ' is-emphasized' : ''}`}
      aria-busy={loading}
    >
      <span>{label}</span>
      {loading ? <LoadingValue /> : <strong>{value}</strong>}
      {loading ? (
        <span
          className="report-skeleton report-overview-loading-detail"
          aria-hidden="true"
        />
      ) : (
        <small>{detail}</small>
      )}
    </div>
  );
}

function projectionDetail(
  projection: MetricsSummary['projections']['todayWithOpenEntries'] | undefined,
  kind: 'open' | 'history',
) {
  if (!projection) return '';
  if (kind === 'open')
    return `Incluye ${projection.openEntries} autos pendientes`;
  if (projection.historicalDays === 0) return 'Sin base histórica suficiente';
  const confidence =
    projection.confidence === 'high'
      ? 'alta'
      : projection.confidence === 'medium'
        ? 'media'
        : 'baja';
  return `${projection.historicalDays} días comparables · confianza ${confidence}`;
}

function projectionValue(
  projection: MetricsSummary['projections']['todayWithOpenEntries'] | undefined,
  kind: 'open' | 'history',
) {
  if (!projection) return '—';
  return kind === 'history' && projection.historicalDays === 0
    ? 'Sin historial'
    : money(projection.value);
}

export function StatisticsOverview({
  summary,
  month,
  summaryLoading,
  monthLoading,
  monthError,
}: Props) {
  const occupancy = summary?.occupancy;
  const pct = occupancy?.occupancyPct;
  const delta = summary?.comparison.previousDay.revenueDeltaPct;
  const projections = summary?.projections;

  return (
    <section
      className="report-overview"
      aria-label="Panorama del estacionamiento"
    >
      <article className="report-overview-card" aria-busy={summaryLoading}>
        <span className="report-overview-label">Ocupación actual</span>
        {summaryLoading ? (
          <>
            <LoadingValue />
            <span
              className="report-skeleton report-overview-loading-progress"
              aria-hidden="true"
            />
            <span className="sr-only">Cargando ocupación</span>
          </>
        ) : pct == null ? (
          <>
            <strong className="report-overview-value report-overview-value--unknown">
              {summary ? 'Capacidad sin configurar' : 'No disponible'}
            </strong>
            {summary && (
              <p className="report-overview-caption">
                {occupancy?.occupied} vehículos adentro
              </p>
            )}
          </>
        ) : (
          <>
            <div className="report-overview-occupancy">
              <strong className="report-overview-value report-overview-value--brand">
                {Math.round(pct * 100)}%
              </strong>
              <span>
                {occupancy?.occupied} / {occupancy?.capacity} plazas
              </span>
            </div>
            <progress
              className="report-occupancy-progress"
              value={Math.min(100, pct * 100)}
              max={100}
              aria-label="Porcentaje de ocupación"
            />
            <p className="report-overview-caption">
              {occupancy?.free} plazas libres
              {occupancy?.reservedHeld
                ? ` · ${occupancy.reservedHeld} reservadas`
                : ''}
            </p>
          </>
        )}
        <div className="report-overview-bottom report-overview-bottom--pair">
          <div>
            <span>Ingresos hoy</span>
            {summaryLoading ? (
              <LoadingValue />
            ) : (
              <strong>
                {summary?.today.vehiclesIn.toLocaleString('es-AR') ?? '—'}
              </strong>
            )}
          </div>
          <div>
            <span>Egresos hoy</span>
            {summaryLoading ? (
              <LoadingValue />
            ) : (
              <strong>
                {summary?.today.vehiclesOut.toLocaleString('es-AR') ?? '—'}
              </strong>
            )}
          </div>
        </div>
      </article>

      <article className="report-overview-card" aria-busy={summaryLoading}>
        <span className="report-overview-label">Recaudación del día</span>
        {summaryLoading ? (
          <LoadingValue />
        ) : (
          <strong className="report-overview-value">
            {summary ? money(summary.today.revenue) : 'No disponible'}
          </strong>
        )}
        <p
          className={`report-overview-caption${delta != null && delta > 0 ? ' is-positive' : delta != null && delta < 0 ? ' is-negative' : ''}`}
        >
          {summaryLoading ? (
            <span
              className="report-skeleton report-overview-loading-detail"
              aria-hidden="true"
            />
          ) : delta == null ? (
            summary ? (
              'Sin datos de ayer para comparar'
            ) : (
              'Sin datos para mostrar'
            )
          ) : (
            `${delta > 0 ? '+' : ''}${Math.round(delta * 100)}% frente a ayer`
          )}
        </p>
        <div className="report-overview-bottom report-overview-bottom--projections">
          <Projection
            label="Proyección con autos en base"
            value={projectionValue(projections?.todayWithOpenEntries, 'open')}
            detail={projectionDetail(projections?.todayWithOpenEntries, 'open')}
            loading={summaryLoading}
            emphasized
          />
          <Projection
            label="Proyección por tendencia"
            value={projectionValue(
              projections?.todayHistoricalForecast,
              'history',
            )}
            detail={projectionDetail(
              projections?.todayHistoricalForecast,
              'history',
            )}
            loading={summaryLoading}
          />
        </div>
      </article>

      <article
        className="report-overview-card"
        aria-busy={monthLoading || summaryLoading}
      >
        <span className="report-overview-label">Recaudación del mes</span>
        {monthLoading ? (
          <LoadingValue />
        ) : (
          <strong className="report-overview-value">
            {monthError
              ? 'No disponible'
              : month
                ? money(month.totals.revenue)
                : '—'}
          </strong>
        )}
        <p className="report-overview-caption">
          Acumulado hasta la hora indicada
        </p>
        {monthError && !monthLoading && (
          <p className="report-error" role="alert">
            No se pudo cargar la recaudación del mes.
          </p>
        )}
        <div className="report-overview-bottom report-overview-bottom--projections">
          <Projection
            label="Proyección con autos en base"
            value={projectionValue(projections?.monthWithOpenEntries, 'open')}
            detail={projectionDetail(projections?.monthWithOpenEntries, 'open')}
            loading={summaryLoading}
            emphasized
          />
          <Projection
            label="Proyección por tendencia"
            value={projectionValue(
              projections?.monthHistoricalForecast,
              'history',
            )}
            detail={projectionDetail(
              projections?.monthHistoricalForecast,
              'history',
            )}
            loading={summaryLoading}
          />
        </div>
      </article>
    </section>
  );
}
