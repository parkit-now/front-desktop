import type {
  PaginationState,
  SortingFn,
  SortingState,
} from '@tanstack/react-table';

export const NON_PICKABLE_COLUMN_IDS = new Set([
  'acciones',
  'actions',
  'Acciones',
  'info',
]);

/**
 * Rango numérico de un filtro (p. ej. monto): cualquiera de los dos extremos.
 * Gemelo de front-web `features/data-table/utils.ts`.
 */
export type NumberRange = { min?: number; max?: number };

export function isNumberRangeActive(range: NumberRange | undefined): boolean {
  return range?.min !== undefined || range?.max !== undefined;
}

/** Extremos inclusivos; una fila sin número sólo pasa si no hay rango. */
export function inNumberRange(
  value: unknown,
  range: NumberRange | undefined,
): boolean {
  if (!range || !isNumberRangeActive(range)) return true;
  if (typeof value !== 'number' || Number.isNaN(value)) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

/** Valor persistido (localStorage) → rango válido, o `undefined`. */
export function normalizeNumberRange(value: unknown): NumberRange | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as { min?: unknown; max?: unknown };
  const bound = (item: unknown) =>
    typeof item === 'number' && Number.isFinite(item) ? item : undefined;
  const range = { min: bound(raw.min), max: bound(raw.max) };
  return isNumberRangeActive(range) ? range : undefined;
}

export function normalizeText(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            typeof value === 'bigint'
          ? String(value)
          : '';

  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export const caseInsensitiveSort: SortingFn<unknown> = (
  rowA,
  rowB,
  columnId,
) => {
  const left = normalizeText(rowA.getValue(columnId));
  const right = normalizeText(rowB.getValue(columnId));
  return left.localeCompare(right, 'es');
};

export function defaultSortOrder(keys: string[]): SortingState {
  return keys.map((id) => ({ id, desc: false }));
}

export function dedupeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

export function getPaginationPageCount(
  totalRows: number,
  pageSize: number,
): number {
  if (totalRows <= 0) return 0;
  return Math.ceil(totalRows / pageSize);
}

export function getPaginationSummary({
  pageIndex,
  pageSize,
  totalRows,
}: PaginationState & { totalRows: number }): {
  from: number;
  to: number;
  totalRows: number;
} {
  if (totalRows <= 0) return { from: 0, to: 0, totalRows };

  return {
    from: pageIndex * pageSize + 1,
    to: Math.min((pageIndex + 1) * pageSize, totalRows),
    totalRows,
  };
}

export function getVisiblePageNumbers(
  pageIndex: number,
  pageCount: number,
  maxButtons = 5,
): Array<number | 'start-ellipsis' | 'end-ellipsis'> {
  if (pageCount <= 0) return [];

  const pages: Array<number | 'start-ellipsis' | 'end-ellipsis'> = [];
  const half = Math.floor(maxButtons / 2);
  const currentPage = pageIndex + 1;
  let start = Math.max(1, currentPage - half);
  let end = Math.min(pageCount, currentPage + half);

  if (currentPage <= half) {
    end = Math.min(pageCount, maxButtons);
  } else if (currentPage + half >= pageCount) {
    start = Math.max(1, pageCount - maxButtons + 1);
  }

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (start > 1) {
    pages.unshift(1);
    if (start > 2) pages.splice(1, 0, 'start-ellipsis');
  }

  if (end < pageCount) {
    pages.push(pageCount);
    if (end < pageCount - 1) pages.splice(pages.length - 1, 0, 'end-ellipsis');
  }

  return pages;
}
