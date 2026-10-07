// @vitest-environment happy-dom
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataTable } from './DataTable';
import {
  saveTableTemplate,
  type TableViewConfig,
} from '../table-view-template';

const scope = {
  userId: 'user',
  tenantId: 'tenant',
  tableKey: 'movements-test',
};
const data = [
  { plate: 'ACT123', cashSessionId: 'active', notes: 'actual' },
  { plate: 'OLD123', cashSessionId: 'closed', notes: 'anterior' },
];
const columns: ColumnDef<(typeof data)[number], unknown>[] = [
  { accessorKey: 'plate', header: 'Patente' },
  { accessorKey: 'cashSessionId', header: 'Caja', filterFn: 'includesSome' },
  { accessorKey: 'notes', header: 'Notas' },
];
const initialFilters: ColumnFiltersState = [
  { id: 'cashSessionId', value: ['closed'] },
];
const savedConfig: TableViewConfig = {
  version: 1,
  columns: {
    visibility: { notes: false },
    order: ['cashSessionId', 'plate', 'notes'],
    pinnedLeft: [],
  },
  filters: [{ id: 'cashSessionId', value: ['active'] }],
  sorting: [],
  globalSearch: '',
  pagination: { pageSize: 20 },
};
let root: Root;
let container: HTMLDivElement;
async function render(overrideSaved = true, overrideKey?: number) {
  await act(() =>
    Promise.resolve(
      root.render(
        <DataTable
          data={data}
          columns={columns}
          templateScope={scope}
          initialColumnFilters={initialFilters}
          initialColumnFiltersOverridePersistedState={overrideSaved}
          columnFiltersOverride={[]}
          columnFiltersOverrideKey={overrideKey}
        />,
      ),
    ),
  );
}
function rows() {
  return [...container.querySelectorAll('tbody tr')].map(
    (row) => row.textContent,
  );
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
  localStorage.clear();
});

describe('filtro inicial de caja', () => {
  it('se conserva al montar sin plantilla ni orden explicita de limpiar filtros', async () => {
    await render();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('OLD123');
    expect(rows()[0]).not.toContain('ACT123');
  });
  it('tiene prioridad sobre filtros y busqueda guardados sin perder el orden o la visibilidad', async () => {
    saveTableTemplate(scope, {
      name: 'Otra caja',
      config: { ...savedConfig, globalSearch: 'ACT123' },
    });
    await render();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('OLD123');
    expect(rows()[0]).not.toContain('anterior');
    const headers = [...container.querySelectorAll('thead th')].map(
      (th) => th.textContent,
    );
    expect(headers[0]).toContain('Caja');
    expect(headers[1]).toContain('Patente');
  });
  it('restaura los filtros guardados para las tablas sin prioridad de filtro inicial', async () => {
    saveTableTemplate(scope, { name: 'Otra caja', config: savedConfig });
    await render(false);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('ACT123');
  });
  it('permite limpiar el filtro despues de abrir', async () => {
    await render();
    await render(true, 1);
    expect(rows()).toHaveLength(2);
  });
});
