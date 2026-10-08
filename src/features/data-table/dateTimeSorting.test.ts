import {
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
} from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';
import { dateTimeSorting } from './utils';

type DateColumn =
  | 'enteredAt'
  | 'leftAt'
  | 'openedAt'
  | 'closedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'entryAt';
type Entry = { id: string; enteredAt: string } & Partial<
  Record<DateColumn, string | null>
>;

const unusedFilter = () => {
  throw new Error('Unexpected custom filter');
};

function historyTable(
  data: Entry[],
  column: DateColumn,
  desc = false,
  pageSize = 20,
  day?: string,
  dateOnly = true,
) {
  const columns: ColumnDef<Entry>[] = [
    {
      id: column,
      accessorFn: (row) =>
        dateOnly ? (row[column]?.slice(0, 10) ?? '') : row[column],
      sortingFn: dateTimeSorting((row) => row[column]),
      filterFn: 'equals',
    },
  ];
  return createTable({
    data,
    columns,
    filterFns: {
      includesSome: unusedFilter,
      dateRange: unusedFilter,
      numberRange: unusedFilter,
    },
    state: {
      sorting: [{ id: column, desc }],
      pagination: { pageIndex: 0, pageSize },
      columnFilters: day ? [{ id: column, value: day }] : [],
    },
    onStateChange: () => {},
    renderFallbackValue: null,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
}

const entries: Entry[] = [
  {
    id: 'late',
    enteredAt: '2026-09-27T23:29:00-03:00',
    leftAt: '2026-09-27T23:30:00-03:00',
  },
  {
    id: 'early',
    enteredAt: '2026-09-27T23:14:00-03:00',
    leftAt: '2026-09-27T23:29:00-03:00',
  },
  {
    id: 'middle',
    enteredAt: '2026-09-27T23:14:30-03:00',
    leftAt: '2026-09-27T23:29:30-03:00',
  },
];

describe('history date-time sorting', () => {
  describe.each<DateColumn>(['enteredAt', 'leftAt'])('%s', (column) => {
    it.each([false, true])('sorts same-day times (descending: %s)', (desc) => {
      const table = historyTable(entries, column, desc);
      expect(table.getRowModel().rows.map((row) => row.id)).toEqual(
        desc ? ['late', 'middle', 'early'] : ['early', 'middle', 'late'],
      );
      expect(table.getRowModel().rows[0].getValue(column)).toBe('2026-09-27');
    });
  });

  it('compares instants across dates and timezone offsets', () => {
    const data: Entry[] = [
      { id: 'later', enteredAt: '2026-09-27T23:30:00-03:00' },
      { id: 'earlier', enteredAt: '2026-09-28T01:00:00Z' },
    ];
    expect(
      historyTable(data, 'enteredAt')
        .getRowModel()
        .rows.map((row) => row.id),
    ).toEqual(['earlier', 'later']);
  });

  it.each([false, true])(
    'handles missing and invalid exits (descending: %s)',
    (desc) => {
      const data: Entry[] = [
        entries[0],
        { id: 'missing', enteredAt: entries[0].enteredAt },
        { id: 'null', enteredAt: entries[0].enteredAt, leftAt: null },
        { id: 'invalid', enteredAt: entries[0].enteredAt, leftAt: 'invalid' },
      ];
      expect(
        historyTable(data, 'leftAt', desc)
          .getRowModel()
          .rows.map((row) => row.id),
      ).toEqual(
        desc
          ? ['late', 'missing', 'null', 'invalid']
          : ['missing', 'null', 'invalid', 'late'],
      );
    },
  );

  it('preserves stable order for identical timestamps', () => {
    const data = [entries[0], { ...entries[0], id: 'same' }];
    expect(
      historyTable(data, 'enteredAt')
        .getRowModel()
        .rows.map((row) => row.id),
    ).toEqual(['late', 'same']);
  });

  it('sorts the complete set before pagination', () => {
    const table = historyTable(entries, 'enteredAt', false, 1);
    expect(table.getRowModel().rows.map((row) => row.id)).toEqual(['early']);
  });

  it('keeps day-only filtering independent of time sorting', () => {
    const data = [
      ...entries,
      { id: 'other-day', enteredAt: '2026-09-26T23:30:00-03:00' },
    ];
    const table = historyTable(data, 'enteredAt', false, 20, '2026-09-27');
    expect(table.getRowModel().rows.map((row) => row.id)).toEqual([
      'early',
      'middle',
      'late',
    ]);
  });
});

describe('history cash session column', () => {
  const openedAtById = new Map([
    ['z-early', '2026-09-27T09:00:00-03:00'],
    ['a-late', '2026-09-27T18:00:00-03:00'],
  ]);
  const data = [
    { id: 'late', cashSessionId: 'a-late' },
    { id: 'early', cashSessionId: 'z-early' },
  ];

  function tableFor(desc: boolean, selectedIds: string[] = []) {
    return createTable({
      data,
      columns: [
        {
          id: 'cashSessionId',
          accessorKey: 'cashSessionId',
          sortingFn: dateTimeSorting((row) =>
            openedAtById.get(row.cashSessionId),
          ),
          filterFn: (row, columnId, value: string[]) =>
            value.includes(row.getValue(columnId)),
        },
      ],
      filterFns: {
        includesSome: unusedFilter,
        dateRange: unusedFilter,
        numberRange: unusedFilter,
      },
      state: {
        sorting: [{ id: 'cashSessionId', desc }],
        columnFilters: selectedIds.length
          ? [{ id: 'cashSessionId', value: selectedIds }]
          : [],
      },
      onStateChange: () => {},
      renderFallbackValue: null,
      getRowId: (row) => row.id,
      getCoreRowModel: getCoreRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      getSortedRowModel: getSortedRowModel(),
    });
  }

  it.each([false, true])(
    'sorts by opening time, not ID (descending: %s)',
    (desc) => {
      expect(
        tableFor(desc)
          .getRowModel()
          .rows.map((row) => row.id),
      ).toEqual(desc ? ['late', 'early'] : ['early', 'late']);
    },
  );

  it('keeps filtering by cash session ID', () => {
    const table = tableFor(true, ['z-early']);
    expect(table.getRowModel().rows.map((row) => row.id)).toEqual(['early']);
    expect(table.getRowModel().rows[0].getValue('cashSessionId')).toBe(
      'z-early',
    );
  });
});

describe('date-time columns in other tables', () => {
  const rows = entries.map((entry) => ({
    ...entry,
    openedAt: entry.enteredAt,
    closedAt: entry.leftAt,
    createdAt: entry.enteredAt,
    updatedAt: entry.enteredAt,
    entryAt: entry.enteredAt,
  }));

  describe.each<DateColumn>([
    'openedAt',
    'closedAt',
    'createdAt',
    'updatedAt',
    'entryAt',
  ])('%s', (column) => {
    it.each([true, false])(
      'sorts same-day times with date-only accessor: %s',
      (dateOnly) => {
        for (const desc of [false, true]) {
          const table = historyTable(
            rows,
            column,
            desc,
            20,
            undefined,
            dateOnly,
          );
          expect(table.getRowModel().rows.map((row) => row.id)).toEqual(
            desc ? ['late', 'middle', 'early'] : ['early', 'middle', 'late'],
          );
        }
      },
    );
  });

  it('keeps an open cash session distinguishable from closed sessions', () => {
    const data = [
      ...rows,
      { id: 'open', enteredAt: entries[0].enteredAt, closedAt: null },
    ];
    const table = historyTable(data, 'closedAt', true);
    expect(table.getRowModel().rows.map((row) => row.id)).toEqual([
      'late',
      'middle',
      'early',
      'open',
    ]);
  });
});
