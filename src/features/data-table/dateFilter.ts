import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';

export type DatePresenceLabels = {
  all: string;
  present: string;
  missing: string;
};
export type DateFilterValue = DateRange & { presence?: 'present' | 'missing' };

function validDate(raw: unknown): Date | undefined {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw;
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function normalizeDateFilter(
  value: unknown,
  allowPresence = false,
): DateFilterValue | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const raw = value as { from?: unknown; to?: unknown; presence?: unknown };
  if (allowPresence && raw.presence === 'missing') {
    return { from: undefined, presence: 'missing' };
  }
  const from = validDate(raw.from);
  const presence =
    allowPresence && (raw.presence === 'present' || from)
      ? 'present'
      : undefined;
  if (!from && !presence) return undefined;
  const to = from ? validDate(raw.to) : undefined;
  return { from, ...(to ? { to } : {}), ...(presence ? { presence } : {}) };
}

function dateKey(raw: unknown): string | null {
  if (raw instanceof Date)
    return Number.isNaN(raw.getTime()) ? null : format(raw, 'yyyy-MM-dd');
  return typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : null;
}

export function matchesDateFilter(
  raw: unknown,
  value: unknown,
  allowPresence = false,
): boolean {
  const filter = normalizeDateFilter(value, allowPresence);
  if (!filter) return true;
  const key = dateKey(raw);
  if (filter.presence === 'missing') return !key;
  if (!key) return false;
  if (!filter.from) return true;
  return (
    key >= format(filter.from, 'yyyy-MM-dd') &&
    key <= format(filter.to ?? filter.from, 'yyyy-MM-dd')
  );
}
