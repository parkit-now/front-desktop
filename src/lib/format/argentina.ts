export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const ARS_FORMATTER = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ARGENTINA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: ARGENTINA_TIME_ZONE,
});

type NumericLike = {
  toNumber?: () => number;
  toString?: () => string;
};

function parseNumericString(value: string): number | null {
  const compact = value.trim().replace(/[^\d,.-]/g, '');
  if (compact.length === 0) return null;

  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const normalized =
    lastComma > -1 && lastDot > -1
      ? lastComma > lastDot
        ? compact.replace(/\./g, '').replace(',', '.')
        : compact.replace(/,/g, '')
      : compact.replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toMoneyNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    return parseNumericString(value);
  }

  if (typeof value === 'object' && value !== null) {
    const numericLike = value as NumericLike;
    const numberValue = numericLike.toNumber?.();
    if (numberValue !== undefined) {
      return Number.isFinite(numberValue) ? numberValue : null;
    }

    if (
      numericLike.toString &&
      numericLike.toString !== Object.prototype.toString
    ) {
      return parseNumericString(numericLike.toString());
    }
  }

  return null;
}

export function formatArs(value: unknown): string {
  const parsed = toMoneyNumber(value);
  return parsed === null ? '$ --' : ARS_FORMATTER.format(parsed);
}

export function toMoneyInputString(value: unknown): string {
  const parsed = toMoneyNumber(value);
  return parsed === null ? '' : parsed.toFixed(2);
}

export function formatArgentinaDateTime(value: string | Date | null): string {
  if (!value) return 'Sin fecha';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';

  return ARGENTINA_DATE_TIME_FORMATTER.format(date);
}
