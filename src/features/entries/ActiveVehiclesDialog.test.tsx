// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import ExcelJS from 'exceljs';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import {
  button,
  change,
  cleanup,
  click,
  field,
  mount,
  waitForText,
} from '../../test/dom';
import * as excelExport from '../data-table/excelExport';
import {
  TableViewConfigSchema,
  saveTableTemplate,
} from '../table-view-template';
import { ActiveVehiclesDialog } from './ActiveVehiclesDialog';

const mock = vi.hoisted(() => ({ save: vi.fn(), online: true }));
vi.mock('../../lib/download', () => ({ saveBlob: mock.save }));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mock.online }),
}));

function entry(index: number, overrides: Partial<LocalEntry> = {}): LocalEntry {
  return {
    id: `entry-${index}`,
    tenantId: 'tenant',
    plate: `AA${String(index).padStart(3, '0')}AA`,
    enteredAt: `2026-11-02T10:${String(index).padStart(2, '0')}:00Z`,
    ticketNumber: index + 1,
    vehicleBrand: 'Volkswagen',
    vehicleModel: 'Bora',
    color: 'NEGRO',
    rateSnapshotName: index % 2 ? 'HORA' : 'DIA',
    cochera: `A${index}`,
    notes: index < 8 ? 'Empresa' : 'Particular',
    version: 1,
    syncSeq: 1,
    updatedAt: '2026-11-02T10:00:00Z',
    ...overrides,
  };
}

async function render() {
  return mount(
    <ActiveVehiclesDialog
      tenantId="tenant"
      userId="user"
      accessToken="token"
      actorRole="operator"
      onExit={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

async function download() {
  await act(async () => {
    button('Descargar Excel').click();
    await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
  });
  const [blob, name] = mock.save.mock.calls[0] as [Blob, string];
  expect(name).toBe('autos-en-base.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await blob.arrayBuffer());
  expect(workbook.worksheets).toHaveLength(1);
  return workbook.getWorksheet('Autos en base')!;
}

function headers(sheet: ExcelJS.Worksheet) {
  return (sheet.getRow(1).values as ExcelJS.CellValue[]).slice(1);
}

describe('Excel de autos en base', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mock.online = true;
    localStorage.clear();
    await localDb.entries.bulkPut(
      Array.from({ length: 10 }, (_, index) => entry(index)),
    );
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('exporta todas las estadías activas del tenant, no solo la página, también sin conexión', async () => {
    mock.online = false;
    await localDb.entries.bulkPut([
      entry(0, {
        ticketNumber: undefined,
        enteredAt: '2026-11-02T02:45:00Z',
        vehicleBrand: undefined,
        vehicleModel: undefined,
        color: undefined,
      }),
      entry(20, { leftAt: '2026-11-02T12:00:00Z' }),
      entry(21, { deletedAt: '2026-11-02T12:00:00Z' }),
      entry(22, { tenantId: 'other-tenant' }),
    ]);
    const container = await render();
    await waitForText('Mostrando 1 a 8 de 10');
    await vi.waitFor(() =>
      expect(container.querySelectorAll('tbody tr')).toHaveLength(8),
    );

    const sheet = await download();
    expect(headers(sheet)).toEqual([
      '#',
      'Patente',
      'Vehículo',
      'Ingreso',
      'Tarifa',
      'Cochera',
      'Notas',
    ]);
    expect(sheet.rowCount).toBe(11);
    expect(sheet.getCell('A2').value).toBe(10);
    expect(sheet.getCell('B2').value).toBe('AA009AA');
    expect(sheet.getCell('C2').value).toBe('Volkswagen\nBora\nNEGRO');
    expect(sheet.getCell('B11').value).toBe('AA000AA');
    expect(sheet.getCell('A11').value).toBeNull();
    expect(sheet.getCell('C11').text).toBe('');
    expect(sheet.getCell('D11').text).toMatch(
      /^01\/11\/2026, 23:45\nEn curso · .+/,
    );
    expect(sheet.getCell('F11').value).toBe('A0');
    expect(sheet.getCell('G11').value).toBe('Empresa');
  });

  it('respeta búsqueda, filtros y orden elegidos en el diálogo', async () => {
    const container = await render();
    await waitForText('AA009AA');
    await change(
      container.querySelector<HTMLInputElement>('.dt-search input')!,
      'Empresa',
    );
    await click('Filtros');
    const panel = container.querySelector<HTMLElement>(
      '[aria-label="Filtros de tabla"]',
    )!;
    await click('Tarifa', panel);
    await click(field('HORA', panel));
    await click(container.querySelector<HTMLElement>('.dt-filter-trigger')!);
    const head = container.querySelector('thead')!;
    await click('Patente', head);
    await click('Patente', head);

    const sheet = await download();
    expect(sheet.rowCount).toBe(5);
    expect([2, 3, 4, 5].map((row) => sheet.getCell(`B${row}`).value)).toEqual([
      'AA007AA',
      'AA005AA',
      'AA003AA',
      'AA001AA',
    ]);
  });

  it('permite buscar un ticket exacto sin mezclar patentes y exporta ese resultado', async () => {
    await localDb.entries.put(entry(0, { ticketNumber: 66 }));
    await localDb.entries.put(
      entry(20, { plate: 'AA066AA', ticketNumber: 166 }),
    );
    const container = await render();
    await waitForText('AA066AA');
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Todos');
    await change(
      container.querySelector<HTMLInputElement>('.dt-search input')!,
      '66',
    );
    expect(container.querySelectorAll('tbody .dt-plate__number')).toHaveLength(
      2,
    );
    await click('Campo de búsqueda');
    await click('Ticket');
    expect(container.querySelectorAll('tbody .dt-plate__number')).toHaveLength(
      1,
    );
    const sheet = await download();
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell('A2').value).toBe(66);
    expect(sheet.getCell('B2').value).toBe('AA000AA');
  });

  it('exporta solo las columnas visibles y en el orden de la vista guardada', async () => {
    saveTableTemplate(
      { userId: 'user', tenantId: 'tenant', tableKey: 'active-vehicles' },
      {
        name: 'Autos pendientes',
        config: TableViewConfigSchema.parse({
          columns: {
            visibility: { ticket: false, vehicle: false, cochera: false },
            order: ['notes', 'plate', 'enteredAt', 'rate'],
            pinnedLeft: [],
          },
          pagination: { pageSize: 5 },
        }),
      },
    );
    await render();
    await waitForText('AA009AA');

    const sheet = await download();
    expect(headers(sheet)).toEqual(['Notas', 'Patente', 'Ingreso', 'Tarifa']);
    expect(sheet.rowCount).toBe(11);
  });

  it('deshabilita la descarga mientras carga cualquiera de las consultas locales', async () => {
    vi.spyOn(localDb.lprDetectionEvents, 'where').mockReturnValue({
      equals: () => ({ toArray: () => new Promise(() => {}) }),
    } as never);
    await render();

    expect((button('Descargar Excel') as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(mock.save).not.toHaveBeenCalled();
  });

  it('deshabilita la descarga sin vehículos o sin coincidencias de búsqueda', async () => {
    await localDb.entries.clear();
    const container = await render();
    await waitForText('No hay vehículos estacionados en este momento.');
    expect((button('Descargar Excel') as HTMLButtonElement).disabled).toBe(
      true,
    );

    await localDb.entries.put(entry(1));
    await waitForText('AA001AA');
    await change(
      container.querySelector<HTMLInputElement>('.dt-search input')!,
      'NO-EXISTE',
    );
    expect((button('Descargar Excel') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('muestra progreso y evita descargas simultáneas', async () => {
    await render();
    await waitForText('AA009AA');
    let resolve!: (blob: Blob) => void;
    const create = vi
      .spyOn(excelExport, 'createExcelBlob')
      .mockImplementationOnce(
        () =>
          new Promise<Blob>((done) => {
            resolve = done;
          }),
      );
    await click('Descargar Excel');
    const exportButton = button('Descargar Excel') as HTMLButtonElement;
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.getAttribute('aria-busy')).toBe('true');
    await click(exportButton);
    expect(create).toHaveBeenCalledOnce();

    await act(async () => {
      resolve(new Blob(['excel']));
      await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    });
    expect(exportButton.disabled).toBe(false);
  });

  it('traduce los errores de descarga y permite volver a intentarlo', async () => {
    mock.save.mockImplementationOnce(() => {
      throw new Error('Export failed');
    });
    await render();
    await waitForText('AA009AA');
    await click('Descargar Excel');
    await waitForText('Ocurrió un error inesperado.');
    expect((button('Descargar Excel') as HTMLButtonElement).disabled).toBe(
      false,
    );
    await click('Descargar Excel');
    await vi.waitFor(() => expect(mock.save).toHaveBeenCalledTimes(2));
  });
});
