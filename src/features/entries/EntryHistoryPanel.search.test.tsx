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
import {
  readPersistedTableState,
  readTableTemplateCollection,
  saveTableTemplate,
  TableViewConfigSchema,
  writePersistedTableState,
} from '../table-view-template';
import { EntryHistoryPanel } from './EntryHistoryPanel';

const mock = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../lib/download', () => ({ saveBlob: mock.save }));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: false }),
}));

const scope = { userId: 'user', tenantId: 'tenant', tableKey: 'entry-history' };
const enteredAt = '2026-11-02T10:00:00Z';
function entry(id: string, overrides: Partial<LocalEntry> = {}): LocalEntry {
  return {
    id,
    tenantId: 'tenant',
    cashSessionId: 'current',
    plate: id,
    ticketNumber: 66,
    enteredAt,
    leftAt: '2026-11-02T11:00:00Z',
    version: 1,
    syncSeq: 1,
    updatedAt: enteredAt,
    ...overrides,
  };
}

async function render(
  inDialog = false,
  actorRole: 'owner' | 'operator' = 'owner',
) {
  const container = await mount(
    <EntryHistoryPanel
      tenantId="tenant"
      userId="user"
      accessToken="token"
      actorRole={actorRole}
      renderTable={inDialog ? (table) => <div>{table}</div> : undefined}
    />,
  );
  await waitForText('Mostrando 1 a');
  return container;
}

function rowPlates(container: HTMLElement) {
  return [...container.querySelectorAll('tbody tr')].map((row) =>
    row.querySelector('.dt-plate__number')?.textContent?.replace(/\s/g, ''),
  );
}

function search(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('.dt-search input')!;
}

async function mode(value: string) {
  const labels: Record<string, string> = {
    all: 'Todos',
    ticket: 'Ticket',
    plate: 'Patente',
  };
  await click('Campo de búsqueda');
  await click(labels[value]);
}

describe('búsqueda por campo del historial', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    await localDb.cashSessions.bulkPut([
      {
        id: 'current',
        tenantId: 'tenant',
        openedAt: enteredAt,
        openingCash: 0,
        version: 1,
        syncSeq: 1,
        updatedAt: enteredAt,
      },
      {
        id: 'closed',
        tenantId: 'tenant',
        openedAt: '2026-11-01T10:00:00Z',
        closedAt: '2026-11-01T20:00:00Z',
        openingCash: 0,
        version: 1,
        syncSeq: 1,
        updatedAt: enteredAt,
      },
    ]);
    await localDb.entries.bulkPut([
      entry('EXACTA'),
      entry('OTRACAJA', {
        cashSessionId: 'closed',
        enteredAt: '2026-11-01T11:00:00Z',
      }),
      entry('AB066CD', { ticketNumber: 5 }),
      entry('OTROTICKET', { ticketNumber: 166 }),
      entry('NOTAS', { ticketNumber: 8, notes: '66' }),
      entry('VEHICULO', { ticketNumber: 9, vehicleModel: 'Modelo 66' }),
      entry('SINTICKET', { ticketNumber: undefined }),
      entry('ELIMINADA', { deletedAt: enteredAt }),
      entry('OTROTENANT', { tenantId: 'other' }),
    ]);
  });

  afterEach(async () => {
    await cleanup();
    localStorage.clear();
  });

  it('conserva la búsqueda general y cambia de campo sin perder el texto, también offline', async () => {
    const container = await render();
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Todos');
    await change(search(container), '66');
    expect(rowPlates(container)).toEqual([
      'AB066CD',
      'EXACTA',
      'NOTAS',
      'OTROTICKET',
      'VEHICULO',
    ]);
    await mode('ticket');
    expect(search(container).value).toBe('66');
    expect(search(container).placeholder).toBe('Buscar por ticket…');
    expect(rowPlates(container)).toEqual(['EXACTA']);
    await mode('plate');
    expect(rowPlates(container)).toEqual(['AB066CD']);
    await mode('all');
    expect(rowPlates(container)).toHaveLength(5);
  });

  it.each(['66', '#66', ' 0066 ', ' #00066 '])(
    'encuentra exclusivamente el ticket completo con %s',
    async (query) => {
      const container = await render();
      await mode('ticket');
      await change(search(container), query);
      expect(rowPlates(container)).toEqual(['EXACTA']);
    },
  );

  it.each(['66x', '6.6', '-66', '66 6', '#', '999999999999999999999'])(
    'no interpreta entradas inválidas ni coincidencias parciales: %s',
    async (query) => {
      const container = await render();
      await mode('ticket');
      await change(search(container), query);
      expect(
        container.querySelectorAll('tbody .dt-plate__number'),
      ).toHaveLength(0);
      expect(container.querySelector('tbody')?.textContent).not.toContain(
        'EXACTA',
      );
      expect(
        container.querySelector('.dt-pagination-summary')?.textContent,
      ).toContain('de 0');
    },
  );

  it('busca fragmentos de patente sin distinguir mayúsculas y conserva el campo al limpiar', async () => {
    const container = await render();
    await mode('plate');
    await change(search(container), 'ab066');
    expect(rowPlates(container)).toEqual(['AB066CD']);
    await click(
      container.querySelector<HTMLButtonElement>('[title="Limpiar búsqueda"]')!,
    );
    expect(search(container).value).toBe('');
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Patente');
    expect(rowPlates(container)).toHaveLength(6);
  });

  it('distingue el ticket cero de una estadía sin ticket y no filtra una consulta vacía', async () => {
    await localDb.entries.put(entry('TICKETCERO', { ticketNumber: 0 }));
    const container = await render();
    await mode('ticket');
    await change(search(container), '000');
    expect(rowPlates(container)).toEqual(['TICKETCERO']);
    await change(search(container), '   ');
    expect(rowPlates(container)).toHaveLength(7);
  });

  it('muestra los tickets repetidos según la caja seleccionada', async () => {
    const container = await render();
    await mode('ticket');
    await change(search(container), '66');
    await click(field('Solo caja actual'));
    expect(rowPlates(container)).toEqual(['EXACTA', 'OTRACAJA']);
    await click('Filtros');
    const panel = container.querySelector<HTMLElement>(
      '[aria-label="Filtros de tabla"]',
    )!;
    await click('Caja', panel);
    const options = [
      ...panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    await click(options[0]);
    expect(rowPlates(container)).toEqual(['EXACTA']);
  });

  it('combina el campo con fechas guardadas, incluso con la columna de ticket oculta', async () => {
    saveTableTemplate(scope, {
      name: 'Tickets de noviembre',
      config: TableViewConfigSchema.parse({
        globalSearch: '66',
        globalSearchMode: 'ticket',
        columns: { visibility: { ticketNumber: false } },
        filters: [
          {
            id: 'enteredAt',
            value: { from: '2026-11-02T00:00:00', to: '2026-11-02T00:00:00' },
          },
        ],
      }),
    });
    const container = await render();
    await click(field('Solo caja actual'));
    expect(rowPlates(container)).toEqual(['EXACTA']);
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Ticket');
    expect(container.querySelector('thead')?.textContent).not.toContain('#');
  });

  it('reinicia la paginación al cambiar de modo', async () => {
    await localDb.entries.bulkPut(
      Array.from({ length: 25 }, (_, index) =>
        entry(`AUTO${index}`, { ticketNumber: index + 100 }),
      ),
    );
    const container = await render();
    await click('Siguiente');
    expect(
      container.querySelector('.dt-pagination-summary')?.textContent,
    ).toContain('Mostrando 21');
    await mode('ticket');
    expect(
      container.querySelector('.dt-pagination-summary')?.textContent,
    ).toContain('Mostrando 1 a 20');
  });

  it('guarda y restaura el campo junto con el texto', async () => {
    const container = await render();
    await mode('ticket');
    await change(search(container), '#66');
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    const saved = readPersistedTableState(scope, ['ticketNumber', 'plate']);
    expect(saved?.config).toMatchObject({
      globalSearch: '#66',
      globalSearchMode: 'ticket',
    });
    await cleanup();
    writePersistedTableState(scope, saved!);
    await localDb.entries.put(entry('EXACTA'));
    await localDb.cashSessions.put({
      id: 'current',
      tenantId: 'tenant',
      openedAt: enteredAt,
      openingCash: 0,
      version: 1,
      syncSeq: 1,
      updatedAt: enteredAt,
    });
    const restored = await render();
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Ticket');
    expect(search(restored).value).toBe('#66');
    expect(rowPlates(restored)).toEqual(['EXACTA']);
  });

  it.each([undefined, 'unknown', 'color'])(
    'usa Todos para vistas anteriores o modos desconocidos: %s',
    async (globalSearchMode) => {
      writePersistedTableState(scope, {
        version: 1,
        config: TableViewConfigSchema.parse({
          globalSearch: '66',
          globalSearchMode,
        }),
        switches: {},
      });
      const container = await render();
      expect(button('Campo de búsqueda').title).toBe('Buscar en: Todos');
      expect(rowPlates(container)).toHaveLength(5);
    },
  );

  it('incluye el campo al guardar una plantilla y vuelve a Todos al quitarla', async () => {
    const container = await render();
    await mode('ticket');
    await change(search(container), '66');
    await click('Plantillas');
    await click('Guardar plantilla');
    await change(field('Nombre'), 'Ticket exacto');
    await click('Guardar');
    expect(
      readTableTemplateCollection(scope).templates[0].config,
    ).toMatchObject({ globalSearch: '66', globalSearchMode: 'ticket' });
    await click('Plantillas');
    await click('Sin plantilla');
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Todos');
    expect(search(container).value).toBe('');
  });

  it('exporta únicamente las filas del campo buscado', async () => {
    const container = await render();
    await mode('ticket');
    await change(search(container), '66');
    await act(async () => {
      button('Descargar Excel').click();
      await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    });
    const [blob] = mock.save.mock.calls[0] as [Blob];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('B2').value).toBe('EXACTA');
    expect(sheet.getCell('B3').value).not.toBe('AB066CD');
  });

  it('exporta solo las coincidencias de Modelo sin mezclar tickets, patentes o notas', async () => {
    const container = await render();
    await click('Campo de búsqueda');
    await click('Modelo');
    await change(search(container), '66');
    expect(rowPlates(container)).toEqual(['VEHICULO']);
    await act(async () => {
      button('Descargar Excel').click();
      await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    });
    const [blob] = mock.save.mock.calls[0] as [Blob];
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('B2').value).toBe('VEHICULO');
    expect(sheet.getCell('B3').value).toBeNull();
  });

  it('reserva el color para Filtros, incluso al buscar en Todos', async () => {
    await localDb.entries.update('EXACTA', { color: 'COLORFILTRO' });
    const container = await render();
    await click('Campo de búsqueda');
    expect(
      [...container.querySelectorAll('[role="menuitemradio"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual([
      'Todos',
      'Ticket',
      'Patente',
      'Marca',
      'Modelo',
      'Receptor de factura',
      'Notas',
    ]);
    await click('Todos');
    await change(search(container), 'COLORFILTRO');
    expect(container.querySelectorAll('tbody .dt-plate__number')).toHaveLength(
      0,
    );
    await change(search(container), '');
    await click('Filtros');
    const panel = container.querySelector<HTMLElement>(
      '[aria-label="Filtros de tabla"]',
    )!;
    await click('Color', panel);
    await click(field('COLORFILTRO', panel));
    expect(rowPlates(container)).toEqual(['EXACTA']);
  });

  it('ofrece el mismo selector en movimientos de caja, con Todos por defecto', async () => {
    const container = await render(true);
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Todos');
    await change(search(container), '66');
    expect(rowPlates(container)).toHaveLength(5);
    await mode('ticket');
    expect(rowPlates(container)).toEqual(['EXACTA']);
  });

  it('reemplaza el antiguo switch por el estado de egreso y exporta solo los autos en base, offline', async () => {
    await localDb.entries.put(entry('ENBASE', { leftAt: undefined }));
    writePersistedTableState(scope, {
      version: 1,
      config: TableViewConfigSchema.parse({}),
      switches: { includeInLot: false, onlyCurrentSession: true },
    });
    const container = await render();
    expect(container.textContent).not.toContain('Incluir autos en base');
    expect(rowPlates(container)).toHaveLength(7);
    await click('Filtros');
    const group = container.querySelector<HTMLElement>(
      '[aria-label="Estado de egreso"]',
    )!;
    expect(field<HTMLInputElement>('Todos', group).checked).toBe(true);
    await click(field('En base', group));
    expect(rowPlates(container)).toEqual(['ENBASE']);
    expect(
      container.querySelector('.dt-filter-date-presence button'),
    ).toBeNull();
    await change(search(container), '#66');
    await mode('ticket');
    expect(rowPlates(container)).toEqual(['ENBASE']);
    await act(() => new Promise((resolve) => setTimeout(resolve, 350)));
    expect(readPersistedTableState(scope, ['leftAt'])?.config.filters).toEqual([
      { id: 'leftAt', value: { presence: 'missing' } },
    ]);
    await act(async () => {
      button('Descargar Excel').click();
      await vi.waitFor(() => expect(mock.save).toHaveBeenCalledOnce());
    });
    const workbook = new ExcelJS.Workbook();
    const [blob] = mock.save.mock.calls[0] as [Blob];
    await workbook.xlsx.load(await blob.arrayBuffer());
    expect(workbook.worksheets[0].getCell('B2').value).toBe('ENBASE');
    expect(workbook.worksheets[0].rowCount).toBe(3);
  });

  it('restaura el estado de egreso incluso con su columna oculta', async () => {
    await localDb.entries.put(entry('ENBASE', { leftAt: undefined }));
    writePersistedTableState(scope, {
      version: 1,
      config: TableViewConfigSchema.parse({
        columns: { visibility: { leftAt: false } },
        filters: [{ id: 'leftAt', value: { presence: 'missing' } }],
      }),
      switches: {},
    });
    const container = await render();
    expect(rowPlates(container)).toEqual(['ENBASE']);
    expect(container.querySelector('thead')?.textContent).not.toContain(
      'Egreso',
    );
    await click(
      container.querySelector<HTMLButtonElement>('.dt-filter-trigger')!,
    );
    expect(
      field<HTMLInputElement>(
        'En base',
        container.querySelector('[aria-label="Estado de egreso"]')!,
      ).checked,
    ).toBe(true);
  });

  it('el estado En base no permite al operador salir de su caja actual', async () => {
    await localDb.entries.bulkPut([
      entry('ENBASE', { leftAt: undefined }),
      entry('OTRABASE', { leftAt: undefined, cashSessionId: 'closed' }),
    ]);
    const container = await render(true, 'operator');
    await click('Filtros');
    await click(
      field(
        'En base',
        container.querySelector('[aria-label="Estado de egreso"]')!,
      ),
    );
    expect(rowPlates(container)).toEqual(['ENBASE']);
    expect(field<HTMLInputElement>('Solo caja actual').checked).toBe(true);
    expect(field<HTMLInputElement>('Solo caja actual').disabled).toBe(true);
  });
});
