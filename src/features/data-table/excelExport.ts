import type { Column, RowData, Table } from '@tanstack/react-table';

export type ExcelValue = string | number | boolean | null;
export type ExcelExportColumn<TData> = {
  header: string;
  value: (row: TData) => ExcelValue;
  width?: number;
  numFmt?: string;
  sum?: boolean;
};
export type ExcelExportOptions<TData> = {
  fileName: string | ((rows: readonly TData[]) => string);
  sheetName?: string;
  onError: (error: unknown) => void;
};

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    exportHeader?: string;
    exportValue?: (row: TData) => ExcelValue;
    exportColumns?: ExcelExportColumn<TData>[];
    excludeFromExport?: boolean;
    filterOnly?: boolean;
    displayColumnId?: string;
  }
}

export type ExcelSnapshot = {
  columns: { header: string; width: number; numFmt?: string; sum?: boolean }[];
  rows: ExcelValue[][];
};

const FILE_DATE_FORMATTER = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'America/Argentina/Buenos_Aires',
});

export function getDateRangeExcelFileName(dates: readonly string[]): string {
  let first: Date | null = null;
  let last: Date | null = null;
  for (const value of dates) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    if (!first || date < first) first = date;
    if (!last || date > last) last = date;
  }
  if (!first || !last) return 'historial.xlsx';

  const formatDate = (date: Date) => {
    const parts = Object.fromEntries(
      FILE_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [
        type,
        value,
      ]),
    );
    return `${parts.day}-${parts.month}-${parts.year}`;
  };
  return `${formatDate(first)}__${formatDate(last)}.xlsx`;
}

function cellValue(value: unknown): ExcelValue {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return null;
}

export function getExcelSnapshot<TData>(table: Table<TData>): ExcelSnapshot {
  const columns = [
    ...table.getLeftVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getRightVisibleLeafColumns(),
  ].filter(
    (column) =>
      !column.columnDef.meta?.excludeFromExport &&
      (column.accessorFn ||
        column.columnDef.meta?.exportValue ||
        column.columnDef.meta?.exportColumns?.length),
  );
  const exportColumns = columns.flatMap<{
    column: Column<TData>;
    definition?: ExcelExportColumn<TData>;
  }>((column) => {
    const definitions = column.columnDef.meta?.exportColumns;
    return definitions
      ? definitions.map((definition) => ({ column, definition }))
      : [{ column, definition: undefined }];
  });

  return {
    columns: exportColumns.map(({ column, definition }) => ({
      header:
        definition?.header ??
        column.columnDef.meta?.exportHeader ??
        (typeof column.columnDef.header === 'string'
          ? column.columnDef.header
          : column.id),
      width:
        definition?.width ?? Math.max(10, Math.min(50, column.getSize() / 7)),
      ...(definition?.numFmt ? { numFmt: definition.numFmt } : {}),
      ...(definition?.sum ? { sum: true } : {}),
    })),
    // The pre-pagination model already includes the table's filters and sorting.
    rows: table
      .getPrePaginationRowModel()
      .rows.map((row) =>
        exportColumns.map(({ column, definition }) =>
          cellValue(
            definition
              ? definition.value(row.original)
              : column.columnDef.meta?.exportValue
                ? column.columnDef.meta.exportValue(row.original)
                : row.getValue(column.id),
          ),
        ),
      ),
  };
}

export async function createExcelBlob(
  snapshot: ExcelSnapshot,
  sheetName = 'Historial',
): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = snapshot.columns.map((column) => ({
    header: column.header,
    width: column.width,
    ...(column.numFmt ? { style: { numFmt: column.numFmt } } : {}),
  }));
  sheet.addRows(snapshot.rows);
  if (
    snapshot.rows.length > 0 &&
    snapshot.columns.some((column) => column.sum)
  ) {
    const totalRow = sheet.addRow(snapshot.columns.map(() => null));
    const labelIndex = snapshot.columns.findIndex((column) => !column.sum);
    if (labelIndex >= 0) totalRow.getCell(labelIndex + 1).value = 'Total';
    snapshot.columns.forEach((column, index) => {
      if (!column.sum) return;
      const letter = sheet.getColumn(index + 1).letter;
      const total = snapshot.rows.reduce((sum, row) => {
        const value = row[index];
        return sum + (typeof value === 'number' ? value : 0);
      }, 0);
      totalRow.getCell(index + 1).value = {
        formula: `SUM(${letter}2:${letter}${snapshot.rows.length + 1})`,
        result: Number(total.toFixed(2)),
      };
    });
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'thin', color: { argb: 'FFD0D9E6' } } };
    });
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (snapshot.columns.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: snapshot.rows.length + 1, column: snapshot.columns.length },
    };
  }
  sheet.getRow(1).font = { bold: true };
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true };
    let lines = 1;
    row.eachCell((cell) => {
      if (typeof cell.value === 'string') {
        lines = Math.max(lines, cell.value.split('\n').length);
      }
    });
    if (lines > 1) row.height = lines * 15;
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
