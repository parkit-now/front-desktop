// @vitest-environment happy-dom
import { createTable, filterFns, getCoreRowModel } from '@tanstack/react-table';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExcelExportButton } from './ExcelExportButton';
import type { ExcelExportOptions } from '../excelExport';

const mock = vi.hoisted(() => ({
  create: vi.fn(),
  snapshot: vi.fn(),
  save: vi.fn(),
}));
vi.mock('../excelExport', () => ({
  createExcelBlob: mock.create,
  getExcelSnapshot: mock.snapshot,
}));
vi.mock('../../../lib/download', () => ({ saveBlob: mock.save }));

const table = createTable({
  data: [{ plate: 'AAA111' }],
  filterFns: {
    includesSome: filterFns.arrIncludesSome,
    dateRange: filterFns.includesString,
    numberRange: filterFns.inNumberRange,
  },
  columns: [{ accessorKey: 'plate', header: 'Patente' }],
  state: {},
  onStateChange: () => undefined,
  renderFallbackValue: null,
  getCoreRowModel: getCoreRowModel(),
});
const options: ExcelExportOptions<{ plate: string }> = {
  fileName: 'historial.xlsx',
  onError: vi.fn(),
};
let root: Root;
let container: HTMLDivElement;
function button() {
  return container.querySelector('button')!;
}
async function render(
  disabled = false,
  currentTable = table,
  currentOptions = options,
) {
  await act(() =>
    Promise.resolve(
      root.render(
        <ExcelExportButton
          table={currentTable}
          options={currentOptions}
          disabled={disabled}
        />,
      ),
    ),
  );
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mock.snapshot.mockReturnValue({
    columns: [{ header: 'Patente', width: 20 }],
    rows: [['AAA111']],
  });
  mock.create.mockResolvedValue(new Blob(['xlsx']));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

describe('boton de Excel', () => {
  it('resuelve el nombre con las mismas filas de la descarga y lo congela antes de esperar', async () => {
    const currentTable = createTable({ ...table.options });
    const fileName = vi.fn(() => '05-10-2026__07-10-2026.xlsx');
    let resolve!: (blob: Blob) => void;
    mock.create.mockReturnValue(
      new Promise<Blob>((done) => {
        resolve = done;
      }),
    );
    await render(false, currentTable, { ...options, fileName });
    await act(() => Promise.resolve(button().click()));
    expect(fileName).toHaveBeenCalledWith([{ plate: 'AAA111' }]);
    currentTable.setOptions((previous) => ({
      ...previous,
      data: [{ plate: 'BBB222' }],
    }));
    await act(() => Promise.resolve(resolve(new Blob(['xlsx']))));
    expect(fileName).toHaveBeenCalledOnce();
    expect(mock.save).toHaveBeenCalledWith(
      expect.any(Blob),
      '05-10-2026__07-10-2026.xlsx',
    );
  });
  it('descarga una sola vez ante doble clic y toma el snapshot antes de esperar', async () => {
    let resolve!: (blob: Blob) => void;
    mock.create.mockReturnValue(
      new Promise<Blob>((done) => {
        resolve = done;
      }),
    );
    await render();
    await act(() => Promise.resolve(button().click()));
    expect(mock.snapshot).toHaveBeenCalledOnce();
    expect(button().disabled).toBe(true);
    expect(button().getAttribute('aria-busy')).toBe('true');
    await act(() => Promise.resolve(button().click()));
    const blob = new Blob(['xlsx']);
    await act(() => Promise.resolve(resolve(blob)));
    expect(mock.create).toHaveBeenCalledOnce();
    expect(mock.save).toHaveBeenCalledWith(blob, 'historial.xlsx');
    expect(button().disabled).toBe(false);
  });

  it('informa errores y permite reintentar sin descargar un archivo incompleto', async () => {
    const error = new Error('export failed');
    mock.create.mockRejectedValueOnce(error);
    await render();
    await act(() => Promise.resolve(button().click()));
    expect(options.onError).toHaveBeenCalledWith(error);
    expect(mock.save).not.toHaveBeenCalled();
    expect(button().disabled).toBe(false);
    await act(() => Promise.resolve(button().click()));
    expect(mock.save).toHaveBeenCalledOnce();
  });

  it('no permite exportar durante la carga', async () => {
    await render(true);
    await act(() => Promise.resolve(button().click()));
    expect(button().disabled).toBe(true);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('no permite exportar si no hay resultados', async () => {
    const emptyTable = createTable({
      ...table.options,
      data: [],
    });
    await render(false, emptyTable);
    expect(button().disabled).toBe(true);
  });
});
