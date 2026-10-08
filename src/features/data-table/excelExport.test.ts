import {
  createTable,
  filterFns,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type TableState,
} from '@tanstack/react-table';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  createExcelBlob,
  getDateRangeExcelFileName,
  getExcelSnapshot,
} from './excelExport';

type RecordRow = {
  ticket: number;
  plate: string;
  notes: string;
  date: string;
  paid: number | null;
  method: string;
  cuit: string;
};

const data: RecordRow[] = [
  {
    ticket: 1,
    plate: 'AAA111',
    notes: 'Efectivo',
    date: '2026-10-07T12:10:00Z',
    paid: 100,
    method: 'Efectivo',
    cuit: '20427205208',
  },
  {
    ticket: 2,
    plate: 'AAA222',
    notes: 'QR',
    date: '2026-10-07T12:09:00Z',
    paid: 10.25,
    method: 'QR',
    cuit: '20427205208',
  },
  {
    ticket: 3,
    plate: 'BBB333',
    notes: 'Efectivo',
    date: '2026-10-06T12:09:00Z',
    paid: null,
    method: '',
    cuit: '',
  },
];
const columns: ColumnDef<RecordRow>[] = [
  { id: 'select', header: () => null },
  {
    id: 'photo',
    header: '',
    meta: {
      exportHeader: 'Foto',
      exportValue: () => 'Sí',
      excludeFromExport: true,
    },
  },
  { accessorKey: 'ticket', header: '#' },
  { accessorKey: 'plate', header: 'Patente' },
  { accessorKey: 'notes', header: 'Notas' },
  {
    accessorKey: 'date',
    header: 'Ingreso',
    meta: { exportValue: (row) => row.date },
  },
  {
    accessorKey: 'paid',
    header: 'Cobrado',
    meta: {
      exportValue: (row) =>
        row.paid == null ? '' : `${row.paid}\n${row.method}`,
    },
  },
  { accessorKey: 'cuit', header: 'Receptor' },
];

function makeTable(state: Partial<TableState> = {}, rows = data) {
  const table = createTable({
    data: rows,
    columns,
    filterFns: {
      includesSome: filterFns.arrIncludesSome,
      dateRange: filterFns.includesString,
      numberRange: filterFns.inNumberRange,
    },
    state: {},
    onStateChange: () => undefined,
    renderFallbackValue: null,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  table.setOptions((options) => ({
    ...options,
    state: { ...table.initialState, ...state },
  }));
  return table;
}

describe('Excel de la vista filtrada', () => {
  it('nombra el archivo con las fechas extremas independientemente del orden de filas', () => {
    expect(
      getDateRangeExcelFileName([
        '2026-10-07T12:00:00Z',
        '2026-10-05T12:00:00Z',
        '2026-10-06T12:00:00Z',
      ]),
    ).toBe('05-10-2026__07-10-2026.xlsx');
  });

  it('calcula el nombre solo con los resultados filtrados incluso con ingreso oculto y paginado', () => {
    const table = makeTable({
      globalFilter: 'AAA',
      columnVisibility: { date: false },
      pagination: { pageIndex: 0, pageSize: 1 },
    });
    const dates = table
      .getPrePaginationRowModel()
      .rows.map((row) => row.original.date);
    expect(getDateRangeExcelFileName(dates)).toBe(
      '07-10-2026__07-10-2026.xlsx',
    );
    expect(getDateRangeExcelFileName(data.map((row) => row.date))).toBe(
      '06-10-2026__07-10-2026.xlsx',
    );
  });

  it('usa el dia de Argentina y compara cronologicamente entre meses y años', () => {
    expect(
      getDateRangeExcelFileName([
        '2027-01-01T02:00:00Z',
        '2026-12-01T03:00:00Z',
        '2027-01-01T04:00:00Z',
      ]),
    ).toBe('01-12-2026__01-01-2027.xlsx');
    expect(getDateRangeExcelFileName(['2026-10-08T01:00:00Z'])).toBe(
      '07-10-2026__07-10-2026.xlsx',
    );
  });

  it('ignora fechas invalidas y usa un nombre neutro si no hay ninguna valida', () => {
    expect(getDateRangeExcelFileName(['invalid', '2026-10-05T12:00:00Z'])).toBe(
      '05-10-2026__05-10-2026.xlsx',
    );
    expect(getDateRangeExcelFileName(['invalid'])).toBe('historial.xlsx');
    expect(getDateRangeExcelFileName([])).toBe('historial.xlsx');
  });
  it('incluye todas las filas filtradas y ordenadas, no solo la pagina', () => {
    const table = makeTable({
      globalFilter: 'AAA',
      sorting: [{ id: 'ticket', desc: true }],
      columnVisibility: { cuit: false },
      pagination: { pageIndex: 0, pageSize: 1 },
    });
    expect(table.getRowModel().rows).toHaveLength(1);
    const snapshot = getExcelSnapshot(table);
    expect(snapshot.rows).toHaveLength(2);
    expect(snapshot.rows.map((row) => row[0])).toEqual([2, 1]);
    expect(snapshot.columns.map((column) => column.header)).not.toContain(
      'Foto',
    );
    expect(snapshot.columns.map((column) => column.header)).not.toContain(
      'Receptor',
    );
    expect(snapshot.columns.map((column) => column.header)).not.toContain(
      'select',
    );
  });

  it('respeta filtros de columna junto con la busqueda', () => {
    const table = makeTable({
      globalFilter: 'AAA',
      columnFilters: [{ id: 'notes', value: 'QR' }],
    });
    expect(getExcelSnapshot(table).rows.map((row) => row[1])).toEqual([
      'AAA222',
    ]);
  });

  it('respeta el orden visible, incluyendo columnas fijadas', () => {
    const table = makeTable({
      columnOrder: [
        'notes',
        'paid',
        'plate',
        'ticket',
        'photo',
        'date',
        'cuit',
      ],
      columnPinning: { left: ['ticket'], right: ['date'] },
      columnVisibility: { cuit: false, photo: false },
    });
    const snapshot = getExcelSnapshot(table);
    expect(snapshot.columns.map((column) => column.header)).toEqual([
      '#',
      'Notas',
      'Cobrado',
      'Patente',
      'Ingreso',
    ]);
    expect(snapshot.rows[0]).toEqual([
      1,
      'Efectivo',
      '100\nEfectivo',
      'AAA111',
      '2026-10-07T12:10:00Z',
    ]);
  });

  it('no incluye filas descartadas por los switches del historial', () => {
    expect(getExcelSnapshot(makeTable({}, [data[1]])).rows).toHaveLength(1);
  });

  it('mantiene el snapshot aunque despues cambien filtros y columnas', () => {
    const table = makeTable();
    const snapshot = getExcelSnapshot(table);
    table.setOptions((options) => ({
      ...options,
      state: {
        ...table.getState(),
        globalFilter: 'ZZZ',
        columnVisibility: { plate: false },
      },
    }));
    expect(getExcelSnapshot(table).rows).toHaveLength(0);
    expect(snapshot.rows).toHaveLength(3);
    expect(snapshot.columns.map((column) => column.header)).toContain(
      'Patente',
    );
  });

  it('maneja una vista vacia', () => {
    expect(getExcelSnapshot(makeTable({ globalFilter: 'ZZZ' })).rows).toEqual(
      [],
    );
  });

  it('genera un XLSX legible, preserva ceros, centavos y texto sin ejecutar formulas', async () => {
    const snapshot = {
      columns: ['#', 'Patente', 'Cobrado', 'Factura', 'Notas'].map(
        (header) => ({ header, width: 25 }),
      ),
      rows: [
        [
          1,
          'AAA111',
          '10,25\nQR',
          'Facturada\nFactura C\n0007-00000003',
          '=HYPERLINK("evil")',
        ],
        [2, 'BBB222', 0, '', null],
      ],
    };
    const blob = await createExcelBlob(snapshot);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.getWorksheet('Historial')!;
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getCell('C2').value).toBe('10,25\nQR');
    expect(sheet.getCell('D2').value).toBe(
      'Facturada\nFactura C\n0007-00000003',
    );
    expect(sheet.getCell('E2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('E2').value).toBe('=HYPERLINK("evil")');
    expect(sheet.getCell('C3').value).toBe(0);
    expect(sheet.getCell('A1').font.bold).toBe(true);
    expect(sheet.getCell('D2').alignment.wrapText).toBe(true);
    expect(sheet.getRow(2).height).toBe(45);
    expect(sheet.autoFilter).toBe('A1:E3');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});
