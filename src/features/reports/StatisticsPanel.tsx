import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, RefreshCw } from 'lucide-react';
import { localDb } from '../../lib/db/localDb';
import { DateRangeFilter, type DateRange } from '../../lib/ui/DateRangeFilter';
import { AppSelect } from '../../lib/ui/AppSelect';
import {
  getCategoryBreakdown,
  getMetricsSummary,
  getPaymentBreakdown,
  getRevenue,
  getTopPlates,
  type Granularity,
  type ReportScope,
} from '../../lib/api/reports';
import { translateApiError } from '../../lib/api/translate';
import { useNetwork } from '../../lib/network/NetworkContext';
import { PlateCell } from '../data-table/components/PlateCell';
import { ReportMetric, ReportTableLoading } from './ReportLoading';
import { StatisticsOverview } from './StatisticsOverview';
import {
  arDay,
  arIso,
  bucketLabel,
  chartScale,
  dateTime,
  groupByWeekday,
  GRANULARITIES,
  money,
  PRESETS,
  resolveReportRange,
  type Preset,
  type ReportGrouping,
  type WeekdayMode,
  validGranularity,
  weekdayRangeTooLong,
} from './reportUtils';

type Props = { tenantId: string; bearer: string };
const palette = [
  '#1557bf',
  '#13a78a',
  '#e99a22',
  '#d95d6c',
  '#6b71c9',
  '#688a9c',
  '#a47db1',
];

function Breakdown({
  title,
  items,
  total,
  loading,
  error,
}: {
  title: string;
  items: { name: string; amount: number }[];
  total: number;
  loading: boolean;
  error: boolean;
}) {
  let offset = 0;
  const stops = items.map((item, index) => {
    const start = offset;
    offset += total > 0 ? (item.amount / total) * 100 : 0;
    return `${palette[index % palette.length]} ${start}% ${offset}%`;
  });
  return (
    <section className="report-section report-breakdown">
      <h3>{title}</h3>
      {loading ? (
        <div
          className="report-breakdown-loading"
          role="status"
          aria-label={`Cargando ${title.toLowerCase()}`}
        >
          <span
            className="report-skeleton report-skeleton--donut"
            aria-hidden="true"
          />
          <span className="report-breakdown-loading-lines" aria-hidden="true">
            <span className="report-skeleton" />
            <span className="report-skeleton" />
            <span className="report-skeleton" />
            <span className="report-skeleton" />
          </span>
          <span className="sr-only">Cargando {title.toLowerCase()}</span>
        </div>
      ) : error ? (
        <p className="report-error" role="alert">
          No se pudo cargar este desglose.
        </p>
      ) : items.length === 0 || total <= 0 ? (
        <p className="muted">Sin datos en el período.</p>
      ) : (
        <div className="report-breakdown-body">
          <div
            className="report-donut"
            role="img"
            aria-label={`${title}: ${money(total)}`}
            style={{ background: `conic-gradient(${stops.join(', ')})` }}
          >
            <span>{money(total)}</span>
          </div>
          <ul>
            {items.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                <i style={{ background: palette[index % palette.length] }} />
                <span>{item.name}</span>
                <strong>{money(item.amount)}</strong>
                <small>
                  {((item.amount / total) * 100).toLocaleString('es-AR', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  %
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SeriesChart({
  buckets,
  mode,
  granularity,
  weekdayMode,
}: {
  buckets: {
    key: string;
    revenue: number;
    vehiclesIn: number;
    days?: number;
  }[];
  mode: 'revenue' | 'vehiclesIn';
  granularity: ReportGrouping;
  weekdayMode?: WeekdayMode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { top, ticks } = chartScale(
    Math.max(0, ...buckets.map((item) => item[mode])),
  );
  const formatValue = (value: number) =>
    mode === 'revenue'
      ? money(value)
      : `${value.toLocaleString('es-AR')} vehículos`;
  const formatTick = (value: number) => {
    if (mode !== 'revenue') return value.toLocaleString('es-AR');
    if (value >= 1_000_000)
      return `$${(value / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
    if (value >= 1_000)
      return `$${(value / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} mil`;
    return `$${value.toLocaleString('es-AR')}`;
  };
  return buckets.length === 0 ? (
    <p className="muted">Sin movimientos en el período.</p>
  ) : (
    <div className="report-chart-scroll">
      <div
        className="report-chart"
        style={{ minWidth: Math.max(500, buckets.length * 32) }}
      >
        <span className="report-chart-unit">
          {mode === 'revenue' ? 'ARS' : 'Vehículos'}
        </span>
        <div className="report-chart-y" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
              {formatTick(tick)}
            </span>
          ))}
        </div>
        <div
          className="report-chart-plot"
          role="list"
          aria-label={`Serie de ${mode === 'revenue' ? 'recaudación' : 'ingresos de vehículos'}, ${buckets.length} intervalos`}
          onMouseLeave={() => setHovered(null)}
        >
          {ticks.map((tick) => (
            <span
              className="report-chart-gridline"
              key={tick}
              style={{ bottom: `${(tick / top) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          <div className="report-chart-bars">
            {buckets.map((item, index) => {
              const value = item[mode];
              const pct = (value / top) * 100;
              return (
                <div
                  className={`report-chart-bucket${hovered === index ? ' is-hovered' : ''}`}
                  key={item.key}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${item.key}: ${formatValue(value)}${item.days !== undefined ? `, ${item.days} días` : ''}`}
                  onMouseEnter={() => setHovered(index)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                >
                  {buckets.length <= 12 && value > 0 && (
                    <span
                      className="report-chart-value"
                      style={{ bottom: `calc(${pct}% + 3px)` }}
                    >
                      {formatTick(value)}
                    </span>
                  )}
                  <span
                    className="report-chart-bar"
                    style={{ height: `${pct}%` }}
                  />
                </div>
              );
            })}
          </div>
          {hovered !== null && (
            <div
              className="report-chart-tooltip"
              role="tooltip"
              style={
                hovered < 2
                  ? { left: 0 }
                  : hovered >= buckets.length - 2
                    ? { right: 0 }
                    : {
                        left: `${((hovered + 0.5) / buckets.length) * 100}%`,
                        transform: 'translateX(-50%)',
                      }
              }
            >
              <small>{buckets[hovered].key}</small>
              <strong>{formatValue(buckets[hovered][mode])}</strong>
              {buckets[hovered].days !== undefined && (
                <small>
                  {buckets[hovered].days} días ·{' '}
                  {weekdayMode === 'average' ? 'promedio' : 'total'}
                </small>
              )}
            </div>
          )}
        </div>
        <div className="report-chart-x" aria-hidden="true">
          {buckets.map((item) => (
            <small key={item.key}>
              {granularity === 'weekday'
                ? item.key.slice(0, 3)
                : bucketLabel(item.key, granularity)}
            </small>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StatisticsPanel({ tenantId, bearer }: Props) {
  const { isOnline } = useNetwork();
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<Preset>('7d');
  const [anchor, setAnchor] = useState(() => new Date());
  const [range, setRange] = useState<DateRange>();
  const [fromTime, setFromTime] = useState('00:00');
  const [toTime, setToTime] = useState('23:59');
  const [cashSessionId, setCashSessionId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [vehicleCategory, setVehicleCategory] = useState('');
  const [wantedGranularity, setWantedGranularity] =
    useState<ReportGrouping | null>(null);
  const [weekdayMode, setWeekdayMode] = useState<WeekdayMode>('total');
  const [seriesMode, setSeriesMode] = useState<'revenue' | 'vehiclesIn'>(
    'revenue',
  );
  const [topOrder, setTopOrder] = useState<'revenue' | 'visits' | 'duration'>(
    'revenue',
  );
  const cashSessions = useLiveQuery(
    () => localDb.cashSessions.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
  const methods = useLiveQuery(
    () => localDb.paymentMethods.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );
  const categories = useLiveQuery(
    () => localDb.vehicleCategories.toArray(),
    [],
  );
  const cashSession = cashSessions?.find((item) => item.id === cashSessionId);
  const resolved = useMemo(
    () =>
      resolveReportRange({
        preset,
        range,
        fromTime,
        toTime,
        cashSession,
        now: anchor,
      }),
    [preset, range, fromTime, toTime, cashSession, anchor],
  );
  const valid = 'scope' in resolved;
  const granularityCheck = valid
    ? validGranularity(
        resolved.from,
        resolved.to,
        wantedGranularity === 'weekday'
          ? 'day'
          : (wantedGranularity ?? resolved.suggested),
      )
    : null;
  const scope: ReportScope | null = valid ? resolved.scope : null;
  const weekdayTooLong =
    valid &&
    wantedGranularity === 'weekday' &&
    weekdayRangeTooLong(resolved.from, resolved.to);
  const canQuery =
    isOnline && valid && !granularityCheck?.tooFine && !weekdayTooLong;
  const auth = { tenantId, bearer };
  const summary = useQuery({
    queryKey: ['reports', tenantId, 'summary'],
    queryFn: ({ signal }) => getMetricsSummary({ ...auth, signal }),
    enabled: isOnline,
    staleTime: 300_000,
    refetchInterval: isOnline ? 300_000 : false,
    refetchIntervalInBackground: false,
  });
  const generatedAt = summary.data?.generatedAt;
  const monthStart = generatedAt
    ? `${arDay(new Date(generatedAt)).slice(0, 7)}-01`
    : '';
  const month = useQuery({
    queryKey: ['reports', tenantId, 'month', generatedAt],
    queryFn: ({ signal }) =>
      getRevenue({
        ...auth,
        from: arIso(monthStart),
        to: generatedAt!,
        granularity: 'day',
        signal,
      }),
    enabled: isOnline && Boolean(generatedAt),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const series = useQuery({
    queryKey: [
      'reports',
      tenantId,
      'series',
      scope,
      granularityCheck?.granularity,
      paymentMethod,
      vehicleCategory,
    ],
    queryFn: async ({ signal }) => {
      if (!scope || !granularityCheck) throw new Error('Invalid range');
      const input = {
        ...auth,
        ...scope,
        granularity: granularityCheck.granularity,
        paymentMethod: paymentMethod || undefined,
        vehicleCategory: vehicleCategory || undefined,
        signal,
      };
      try {
        return await getRevenue(input);
      } catch (error) {
        if (
          scope.cashSessionId &&
          input.granularity === 'hour' &&
          (error as { status?: number }).status === 400
        )
          return getRevenue({ ...input, granularity: 'day' });
        throw error;
      }
    },
    enabled: canQuery,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const breakdown = useQuery({
    queryKey: ['reports', tenantId, 'methods', scope, vehicleCategory],
    queryFn: ({ signal }) =>
      getPaymentBreakdown({
        ...auth,
        ...scope!,
        vehicleCategory: vehicleCategory || undefined,
        signal,
      }),
    enabled: canQuery,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const categoryBreakdown = useQuery({
    queryKey: ['reports', tenantId, 'categories', scope],
    queryFn: ({ signal }) =>
      getCategoryBreakdown({ ...auth, ...scope!, signal }),
    enabled: canQuery,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const top = useQuery({
    queryKey: ['reports', tenantId, 'top', scope, vehicleCategory, topOrder],
    queryFn: ({ signal }) =>
      getTopPlates({
        ...auth,
        ...scope!,
        vehicleCategory: vehicleCategory || undefined,
        orderBy: topOrder,
        signal,
      }),
    enabled: canQuery,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
  const topItems = top.data?.items ?? [];
  const displayedBuckets = useMemo(
    () =>
      wantedGranularity === 'weekday'
        ? groupByWeekday(series.data?.buckets ?? [], weekdayMode)
        : (series.data?.buckets ?? []),
    [series.data, wantedGranularity, weekdayMode],
  );
  const refresh = () => {
    setAnchor(new Date());
    void queryClient.invalidateQueries({ queryKey: ['reports', tenantId] });
  };

  if (!isOnline)
    return (
      <div className="report-empty">
        <BarChart3 size={25} />
        <strong>Estadísticas disponibles con conexión</strong>
        <span>
          Los datos se calculan en el servidor. La operación local sigue
          disponible.
        </span>
      </div>
    );
  return (
    <div className="report-page">
      <div className="report-heading">
        <div>
          <h2>Panorama actual</h2>
          {generatedAt && (
            <p>Actualizado {dateTime(generatedAt)} (Argentina)</p>
          )}
        </div>
        <button
          className="report-icon-button"
          onClick={refresh}
          title="Actualizar estadísticas"
          aria-label="Actualizar estadísticas"
        >
          <RefreshCw
            size={17}
            className={
              summary.isFetching || month.isFetching || series.isFetching
                ? 'is-spinning'
                : undefined
            }
          />
        </button>
      </div>
      {summary.isError && (
        <p className="report-error" role="alert">
          {translateApiError(summary.error)}
        </p>
      )}
      <StatisticsOverview
        summary={summary.data}
        month={month.data}
        summaryLoading={summary.isLoading}
        monthLoading={month.isLoading}
        monthError={month.isError}
      />
      <section className="report-filters" aria-label="Filtros de estadísticas">
        <h3 className="report-section-divider">Períodos y filtros</h3>
        <div className="report-segments">
          {(Object.keys(PRESETS) as Preset[]).map((item) => (
            <button
              key={item}
              type="button"
              className={preset === item ? 'active' : ''}
              onClick={() => {
                setPreset(item);
                setWantedGranularity(null);
                setAnchor(new Date());
              }}
            >
              {PRESETS[item]}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="report-custom-range">
            <DateRangeFilter
              value={range}
              onChange={setRange}
              placeholder="Rango de fechas"
            />
            <label>
              Desde{' '}
              <input
                type="time"
                value={fromTime}
                onChange={(event) => setFromTime(event.target.value)}
              />
            </label>
            <label>
              Hasta{' '}
              <input
                type="time"
                value={toTime}
                onChange={(event) => setToTime(event.target.value)}
              />
            </label>
            <small>Hora de Argentina</small>
          </div>
        )}
        {preset === 'caja' && (
          <label>
            Caja{' '}
            <AppSelect
              value={cashSessionId}
              onChange={setCashSessionId}
              options={[
                { value: '', label: 'Elegí un turno' },
                ...(cashSessions?.map((item) => ({
                  value: item.id,
                  label: `${dateTime(item.openedAt)}${item.closedAt ? '' : ' · abierta'}`,
                })) ?? []),
              ]}
            />
          </label>
        )}
        <div className="report-filter-row">
          <label>
            Medio de pago{' '}
            <AppSelect
              value={paymentMethod}
              onChange={setPaymentMethod}
              options={[
                { value: '', label: 'Todos' },
                ...(methods?.map((item) => ({
                  value: item.name,
                  label: item.name,
                })) ?? []),
              ]}
            />
          </label>
          <label>
            Categoría{' '}
            <AppSelect
              value={vehicleCategory}
              onChange={setVehicleCategory}
              options={[
                { value: '', label: 'Todas' },
                ...(categories?.map((item) => ({
                  value: item.code,
                  label: item.label,
                })) ?? []),
              ]}
            />
          </label>
          <label>
            Agrupar{' '}
            <AppSelect
              value={
                wantedGranularity === 'weekday'
                  ? 'weekday'
                  : (granularityCheck?.granularity ?? 'day')
              }
              onChange={(value) =>
                setWantedGranularity(value as ReportGrouping)
              }
              options={[
                ...(Object.keys(GRANULARITIES) as Granularity[])
                  .filter(
                    (item) =>
                      item !== 'hour' ||
                      !valid ||
                      new Date(resolved.to).getTime() -
                        new Date(resolved.from).getTime() <=
                        50 * 3_600_000,
                  )
                  .map((item) => ({ value: item, label: GRANULARITIES[item] })),
                { value: 'weekday', label: 'Por día de semana' },
              ]}
            />
          </label>
        </div>
        {vehicleCategory && (
          <p className="report-note">
            Las estadías sin categoría no se incluyen en este filtro.
          </p>
        )}
        {granularityCheck &&
          wantedGranularity !== 'weekday' &&
          wantedGranularity !== granularityCheck.granularity && (
            <p className="report-note">
              El período es demasiado largo para agrupar por hora; se usa la
              agrupación diaria.
            </p>
          )}
      </section>
      {!valid && <div className="report-empty">{resolved.error}</div>}
      {(granularityCheck?.tooFine || weekdayTooLong) && (
        <div className="report-empty">
          {wantedGranularity === 'weekday'
            ? 'El rango supera 1.000 días. Acotá las fechas para agrupar por día de semana.'
            : 'Demasiados intervalos. Elegí una agrupación más amplia.'}
        </div>
      )}
      {canQuery && (
        <>
          {series.isError && (
            <p className="report-error" role="alert">
              {translateApiError(series.error)}
            </p>
          )}
          <div className="report-metrics report-metrics--period">
            <ReportMetric
              label="Recaudación del período"
              loading={series.isLoading}
              value={
                series.isError
                  ? 'No disponible'
                  : series.data
                    ? money(series.data.totals.revenue)
                    : '…'
              }
            />
            <ReportMetric
              label="Ingresos de vehículos"
              loading={series.isLoading}
              value={
                series.isError
                  ? 'No disponible'
                  : (series.data?.totals.vehiclesIn.toLocaleString('es-AR') ??
                    '…')
              }
            />
            <ReportMetric
              label="Egresos de vehículos"
              loading={series.isLoading}
              value={
                series.isError
                  ? 'No disponible'
                  : (series.data?.totals.vehiclesOut.toLocaleString('es-AR') ??
                    '…')
              }
            />
          </div>
          <section className="report-section">
            <div className="report-section-head">
              <h3>Serie temporal</h3>
              <div className="report-segments">
                <button
                  className={seriesMode === 'revenue' ? 'active' : ''}
                  onClick={() => setSeriesMode('revenue')}
                >
                  Recaudación
                </button>
                <button
                  className={seriesMode === 'vehiclesIn' ? 'active' : ''}
                  onClick={() => setSeriesMode('vehiclesIn')}
                >
                  Ingresos
                </button>
              </div>
              {wantedGranularity === 'weekday' && (
                <div
                  className="report-segments"
                  role="group"
                  aria-label="Cálculo por día de semana"
                >
                  <button
                    type="button"
                    className={weekdayMode === 'total' ? 'active' : ''}
                    aria-pressed={weekdayMode === 'total'}
                    onClick={() => setWeekdayMode('total')}
                  >
                    Total
                  </button>
                  <button
                    type="button"
                    className={weekdayMode === 'average' ? 'active' : ''}
                    aria-pressed={weekdayMode === 'average'}
                    onClick={() => setWeekdayMode('average')}
                  >
                    Promedio
                  </button>
                </div>
              )}
            </div>
            {series.isLoading ? (
              <div
                className="report-chart-loading"
                role="status"
                aria-label="Cargando serie temporal"
              >
                <span className="sr-only">Cargando serie temporal</span>
                <div className="report-chart-loading-bars" aria-hidden="true">
                  {[40, 68, 51, 82, 59, 75, 46, 65, 91, 57].map(
                    (height, index) => (
                      <span
                        className="report-skeleton"
                        key={index}
                        style={{ height: `${height}%` }}
                      />
                    ),
                  )}
                </div>
                <div className="report-chart-loading-labels" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, index) => (
                    <span className="report-skeleton" key={index} />
                  ))}
                </div>
              </div>
            ) : series.isError ? (
              <p className="report-error">No se pudo cargar la serie.</p>
            ) : (
              <SeriesChart
                buckets={displayedBuckets}
                mode={seriesMode}
                granularity={
                  wantedGranularity === 'weekday'
                    ? 'weekday'
                    : (series.data?.granularity ??
                      granularityCheck?.granularity ??
                      'day')
                }
                weekdayMode={weekdayMode}
              />
            )}
            <p className="report-note">
              Los autos se cuentan al entrar; sus pagos se suman cuando salen.
              Por eso las barras de autos y dinero pueden corresponder a días
              distintos.
              {scope?.cashSessionId && series.data
                ? ` Ventana efectiva de la caja: ${dateTime(series.data.from)} a ${dateTime(series.data.to)}.`
                : ''}
            </p>
            {series.data?.revenueSource === 'paymentTransactions' && (
              <p className="report-note">
                Este filtro cuenta cobros con detalle de pagos registrado; puede
                ser menor al total sin filtrar.
              </p>
            )}
          </section>
          <div className="report-grid">
            <Breakdown
              title="Por medio de pago"
              total={breakdown.data?.total ?? 0}
              loading={breakdown.isLoading}
              error={breakdown.isError}
              items={[
                ...(breakdown.data?.methods.map((item) => ({
                  name: item.name,
                  amount: item.amount,
                })) ?? []),
                ...(breakdown.data?.unallocated &&
                breakdown.data.unallocated > 0
                  ? [
                      {
                        name: 'Sin detalle',
                        amount: breakdown.data.unallocated,
                      },
                    ]
                  : []),
              ]}
            />
            <Breakdown
              title="Por categoría"
              total={categoryBreakdown.data?.totalRevenue ?? 0}
              loading={categoryBreakdown.isLoading}
              error={categoryBreakdown.isError}
              items={
                categoryBreakdown.data?.categories.map((item) => ({
                  name: item.category
                    ? (categories?.find(
                        (category) => category.code === item.category,
                      )?.label ?? item.category)
                    : 'Sin dato',
                  amount: item.revenue,
                })) ?? []
              }
            />
          </div>
          {breakdown.data && breakdown.data.unallocated > 0 && (
            <p className="report-note">
              “Sin detalle” corresponde a cobros cerrados sin desglose de medio
              de pago.
            </p>
          )}
          {breakdown.data && breakdown.data.unallocated < 0 && (
            <p className="report-note">
              Los pagos registrados superan el total cobrado; revisá posibles
              datos inconsistentes.
            </p>
          )}
          <section className="report-section">
            <div className="report-section-head">
              <h3>Patentes frecuentes</h3>
              <div
                className="report-segments report-order-segments"
                role="group"
                aria-label="Ordenar patentes"
              >
                {(
                  [
                    ['revenue', 'Recaudación'],
                    ['visits', 'Visitas'],
                    ['duration', 'Tiempo'],
                  ] as const
                ).map(([order, label]) => (
                  <button
                    key={order}
                    type="button"
                    className={topOrder === order ? 'active' : ''}
                    aria-pressed={topOrder === order}
                    onClick={() => setTopOrder(order)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {top.isError ? (
              <p className="report-error">No se pudo cargar el ranking.</p>
            ) : top.isLoading ? (
              <ReportTableLoading
                columns={[
                  '#',
                  'Patente',
                  'Recaudación',
                  'Visitas',
                  'Tiempo total',
                  'Promedio',
                ]}
              />
            ) : topItems.length === 0 ? (
              <p className="muted">Sin estadías cerradas en este período.</p>
            ) : (
              <div className="report-table-scroll dt-scroll-shell">
                <table className="report-table dt-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Patente</th>
                      <th>Recaudación</th>
                      <th>Visitas</th>
                      <th>Tiempo total</th>
                      <th>Promedio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topItems.map((item, index) => (
                      <tr key={item.plate}>
                        <td>{index + 1}</td>
                        <td>
                          <PlateCell plate={item.plate} />
                        </td>
                        <td>{money(item.revenue)}</td>
                        <td>{item.visits}</td>
                        <td>{Math.round(item.totalMinutes / 60)} h</td>
                        <td>{Math.round(item.averageMinutes)} min</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
