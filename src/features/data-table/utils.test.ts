import { describe, expect, it } from 'vitest';
import {
  dedupeIds,
  getPaginationPageCount,
  getPaginationSummary,
  getVisiblePageNumbers,
  normalizeText,
} from './utils';

describe('data-table utils', () => {
  it('normalizes text for accent-insensitive search', () => {
    expect(normalizeText('  Estadía Ñandú  ')).toBe('estadia nandu');
  });

  it('dedupes ids preserving order', () => {
    expect(dedupeIds(['name', 'status', 'name', 'updatedAt'])).toEqual([
      'name',
      'status',
      'updatedAt',
    ]);
  });

  it('calculates page count and summary', () => {
    expect(getPaginationPageCount(101, 10)).toBe(11);
    expect(
      getPaginationSummary({ pageIndex: 2, pageSize: 10, totalRows: 27 }),
    ).toEqual({ from: 21, to: 27, totalRows: 27 });
  });

  it('returns visible page numbers with ellipses', () => {
    expect(getVisiblePageNumbers(5, 12)).toEqual([
      1,
      'start-ellipsis',
      4,
      5,
      6,
      7,
      8,
      'end-ellipsis',
      12,
    ]);
  });
});
