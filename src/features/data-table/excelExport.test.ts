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

function makeTable(
  state: Partial<TableState> = {},
  rows = data,
  exportColumns = columns,
) {
  const table = createTable({
    data: rows,
    columns: exportColumns,
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

const splitPaymentColumns: ColumnDef<RecordRow>[] = columns.map((column) =>
  'accessorKey' in column && column.accessorKey === 'paid'
    ? {
        ...column,
        meta: {
          exportColumns: [
            {
              header: 'Monto',
              value: (row) => row.paid,
              numFmt: '#,##0.00',
              sum: true,
            },
            { header: 'Medio de pago', value: (row) => row.method },
          ],
        },
      }
    : column,
);

describe('montos separados y total del Excel', () => {
  it('divide una columna solo en Excel, con una fila por auto y pagos mixtos juntos', () => {
    const table = makeTable(
      {},
      [
        { ...data[0], paid: 5000, method: 'Mercado Pago QR + Efectivo' },
        { ...data[1], paid: 0 },
        data[2],
      ],
      splitPaymentColumns,
    );
    const snapshot = getExcelSnapshot(table);
    expect(table.getColumn('paid')?.columnDef.header).toBe('Cobrado');
    expect(snapshot.columns.map((column) => column.header)).toEqual([
      '#',
      'Patente',
      'Notas',
      'Ingreso',
      'Monto',
      'Medio de pago',
      'Receptor',
    ]);
    expect(snapshot.rows).toHaveLength(3);
    expect(snapshot.rows[0].slice(4, 6)).toEqual([
      5000,
      'Mercado Pago QR + Efectivo',
    ]);
    expect(snapshot.rows[1][4]).toBe(0);
    expect(snapshot.rows[2][4]).toBeNull();
  });

  it('respeta el orden y oculta las dos columnas si Cobrado esta oculto', () => {
    const table = makeTable(
      {
        columnPinning: { left: ['paid'] },
        columnOrder: ['notes', 'paid', 'ticket', 'plate', 'date', 'cuit'],
      },
      data,
      splitPaymentColumns,
    );
    expect(
      getExcelSnapshot(table)
        .columns.slice(0, 2)
        .map((column) => column.header),
    ).toEqual(['Monto', 'Medio de pago']);
    const hidden = getExcelSnapshot(
      makeTable(
        { columnVisibility: { paid: false } },
        data,
        splitPaymentColumns,
      ),
    );
    expect(
      hidden.columns.some(
        (column) =>
          column.header === 'Monto' || column.header === 'Medio de pago',
      ),
    ).toBe(false);
    expect(hidden.columns.some((column) => column.sum)).toBe(false);
  });

  it('exporta importes numericos y una formula Total fuera del filtro, para todos los resultados y no solo la pagina', async () => {
    const table = makeTable(
      {
        globalFilter: 'AAA',
        sorting: [{ id: 'ticket', desc: true }],
        pagination: { pageIndex: 0, pageSize: 1 },
      },
      data,
      splitPaymentColumns,
    );
    const snapshot = getExcelSnapshot(table);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await (await createExcelBlob(snapshot)).arrayBuffer(),
    );
    const sheet = workbook.getWorksheet('Historial')!;
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getCell('E1').value).toBe('Monto');
    expect(sheet.getCell('F1').value).toBe('Medio de pago');
    expect(sheet.getCell('E2').value).toBe(10.25);
    expect(sheet.getCell('E3').value).toBe(100);
    expect(sheet.getCell('E2').type).toBe(ExcelJS.ValueType.Number);
    expect(sheet.getCell('E2').numFmt).toBe('#,##0.00');
    expect(sheet.getCell('A4').value).toBe('Total');
    expect(sheet.getCell('E4').value).toEqual({
      formula: 'SUM(E2:E3)',
      result: 110.25,
    });
    expect(sheet.getCell('E4').numFmt).toBe('#,##0.00');
    expect(sheet.getRow(4).font.bold).toBe(true);
    expect(sheet.autoFilter).toBe('A1:G3');
  });

  it('ignora montos vacios, conserva ceros y evita errores de centavos en el total precalculado', async () => {
    const table = makeTable(
      { columnPinning: { left: ['paid'] } },
      [
        { ...data[0], paid: 0.1 },
        { ...data[1], paid: 0.2 },
        { ...data[2], paid: 0 },
        { ...data[2], paid: null },
      ],
      splitPaymentColumns,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await (await createExcelBlob(getExcelSnapshot(table))).arrayBuffer(),
    );
    const sheet = workbook.getWorksheet('Historial')!;
    expect(sheet.getCell('A4').value).toBe(0);
    expect(sheet.getCell('A5').value).toBeNull();
    expect(sheet.getCell('A6').value).toEqual({
      formula: 'SUM(A2:A5)',
      result: 0.3,
    });
    expect(sheet.getCell('B6').value).toBe('Total');
  });

  it('no suma filas excluidas por filtros ni agrega totales a una vista vacia', async () => {
    const table = makeTable(
      { globalFilter: 'AAA', columnFilters: [{ id: 'notes', value: 'QR' }] },
      data,
      splitPaymentColumns,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await (await createExcelBlob(getExcelSnapshot(table))).arrayBuffer(),
    );
    expect(workbook.getWorksheet('Historial')!.getCell('E3').value).toEqual({
      formula: 'SUM(E2:E2)',
      result: 10.25,
    });
    const empty = new ExcelJS.Workbook();
    await empty.xlsx.load(
      await (
        await createExcelBlob(
          getExcelSnapshot(
            makeTable({ globalFilter: 'ZZZ' }, data, splitPaymentColumns),
          ),
        )
      ).arrayBuffer(),
    );
    expect(empty.getWorksheet('Historial')!.rowCount).toBe(1);
  });
});
