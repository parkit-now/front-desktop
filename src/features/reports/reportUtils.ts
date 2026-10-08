import type { DateRange } from '../../lib/ui/DateRangeFilter';
import type { Granularity, ReportScope } from '../../lib/api/reports';

export const AR_TZ = 'America/Argentina/Buenos_Aires';
const DAY = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: AR_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export type Preset = 'hoy' | '7d' | '30d' | 'custom' | 'caja';
export const PRESETS: Record<Preset, string> = {
  hoy: 'Hoy',
  '7d': '7 días',
  '30d': '30 días',
  custom: 'Personalizado',
  caja: 'Por caja',
};
export const GRANULARITIES: Record<Granularity, string> = {
  hour: 'Por hora',
  day: 'Por día',
  week: 'Por semana',
  month: 'Por mes',
};
export type ReportGrouping = Granularity | 'weekday';
export type WeekdayMode = 'total' | 'average';
export const WEEKDAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];

export function groupByWeekday(
  buckets: {
    key: string;
    revenue: number;
    vehiclesIn: number;
    vehiclesOut: number;
  }[],
  mode: WeekdayMode,
) {
  if (buckets.length === 0) return [];
  const grouped = WEEKDAYS.map((key) => ({
    key,
    revenue: 0,
    vehiclesIn: 0,
    vehiclesOut: 0,
    days: 0,
  }));
  for (const bucket of buckets) {
    const [year, month, day] = bucket.key.slice(0, 10).split('-').map(Number);
    if (!year || !month || !day) continue;
    const index =
      (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
    const target = grouped[index];
    target.revenue += bucket.revenue;
    target.vehiclesIn += bucket.vehiclesIn;
    target.vehiclesOut += bucket.vehiclesOut;
    target.days += 1;
  }
  return grouped.map((bucket) => ({
    ...bucket,
    revenue:
      mode === 'average' && bucket.days
        ? bucket.revenue / bucket.days
        : bucket.revenue,
    vehiclesIn:
      mode === 'average' && bucket.days
        ? bucket.vehiclesIn / bucket.days
        : bucket.vehiclesIn,
    vehiclesOut:
      mode === 'average' && bucket.days
        ? bucket.vehiclesOut / bucket.days
        : bucket.vehiclesOut,
  }));
}

export function weekdayRangeTooLong(from: string, to: string) {
  const start = arDay(new Date(from));
  const end = arDay(new Date(to));
  const days =
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY +
    1;
  return days > 1000;
}

export const money = (value: number) =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: AR_TZ,
  }).format(new Date(value));

const MONTHS_SHORT = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
];
export function bucketLabel(key: string, granularity: Granularity) {
  if (granularity === 'month')
    return MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? key;
  if (granularity === 'hour') return `${key.slice(11, 13)}h`;
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

export function chartScale(max: number) {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };
  const roughStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = factor * magnitude;
  const top = Math.ceil(max / step) * step;
  return {
    top,
    ticks: Array.from(
      { length: Math.round(top / step) + 1 },
      (_, index) => index * step,
    ),
  };
}

export function arDay(date: Date) {
  return dayFormatter.format(date);
}
export function arIso(day: string, time = '00:00') {
  return `${day}T${time.length === 5 ? `${time}:00` : time}-03:00`;
}
function shiftDay(day: string, offset: number) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset, 12))
    .toISOString()
    .slice(0, 10);
}
export function resolveReportRange(input: {
  preset: Preset;
  range?: DateRange;
  fromTime: string;
  toTime: string;
  cashSession?: { id: string; openedAt: string; closedAt?: string };
  now: Date;
}):
  | { scope: ReportScope; from: string; to: string; suggested: Granularity }
  | { error: string } {
  const today = arDay(input.now);
  let from: string;
  let to: string = input.now.toISOString();
  if (input.preset === 'caja') {
    if (!input.cashSession)
      return { error: 'Elegí una caja para ver sus estadísticas.' };
    from = input.cashSession.openedAt;
    to = input.cashSession.closedAt ?? to;
  } else if (input.preset === 'custom') {
    if (!input.range?.from) return { error: 'Elegí un rango de fechas.' };
    const day = (value: Date) =>
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    from = arIso(day(input.range.from), input.fromTime);
    to = arIso(day(input.range.to ?? input.range.from), input.toTime);
  } else {
    from = arIso(
      shiftDay(
        today,
        input.preset === 'hoy' ? 0 : input.preset === '7d' ? -6 : -29,
      ),
    );
  }
  const span = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(span) || span <= 0)
    return { error: 'La fecha de inicio debe ser anterior a la de fin.' };
  const suggested: Granularity =
    span <= 2 * DAY
      ? 'hour'
      : span <= 92 * DAY
        ? 'day'
        : span <= 730 * DAY
          ? 'week'
          : 'month';
  return {
    scope:
      input.preset === 'caja' && input.cashSession
        ? { cashSessionId: input.cashSession.id }
        : { from, to },
    from,
    to,
    suggested,
  };
}

export function validGranularity(
  from: string,
  to: string,
  wanted: Granularity,
) {
  const span = new Date(to).getTime() - new Date(from).getTime();
  const granularity =
    wanted === 'hour' && span > 50 * 3_600_000 ? 'day' : wanted;
  const bucketMs: Record<Granularity, number> = {
    hour: 3_600_000,
    day: DAY,
    week: 7 * DAY,
    month: 30 * DAY,
  };
  return {
    granularity,
    tooFine: Math.ceil(span / bucketMs[granularity]) > 1000,
  };
}
