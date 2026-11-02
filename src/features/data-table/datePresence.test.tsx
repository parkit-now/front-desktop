// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ColumnDef } from '@tanstack/react-table';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DataTable } from './DataTable';
import {
  saveTableTemplate,
  TableViewConfigSchema,
} from '../table-view-template';

const scope = { userId: 'user', tenantId: 'tenant', tableKey: 'date-presence' };
const data = [
  { id: 'active', plate: 'ENBASE', enteredAt: '2026-11-01', leftAt: '' },
  {
    id: 'exited',
    plate: 'EGRESADO',
    enteredAt: '2026-11-01',
    leftAt: '2026-11-02',
  },
  {
    id: 'older',
    plate: 'ANTERIOR',
    enteredAt: '2026-10-01',
    leftAt: '2026-10-02',
  },
];
const columns: ColumnDef<(typeof data)[number], unknown>[] = [
  { accessorKey: 'plate', header: 'Patente' },
  { accessorKey: 'enteredAt', header: 'Ingreso', filterFn: 'dateRange' },
  {
    accessorKey: 'leftAt',
    header: 'Egreso',
    filterFn: 'dateRange',
    meta: {
      datePresenceLabels: {
        all: 'Todos',
        present: 'Egresados',
        missing: 'En base',
      },
    },
  },
];
let root: Root;
let container: HTMLDivElement;
async function render() {
  await act(() =>
    Promise.resolve(
      root.render(
        <DataTable
          data={data}
          columns={columns}
          templateScope={scope}
          filterableColumns={['enteredAt', 'leftAt']}
          initialPageSize={1}
          pageSizeOptions={[1, 10]}
        />,
      ),
    ),
  );
}
async function click(selector: string) {
  const element = container.querySelector<HTMLElement>(selector)!;
  expect(element).toBeTruthy();
  await act(() => Promise.resolve(element.click()));
}
async function select(label: string) {
  const input = [...container.querySelectorAll('label')]
    .find((item) => item.textContent === label)!
    .querySelector('input')!;
  await act(() => Promise.resolve(input.click()));
}
function selected() {
  return container.querySelector<HTMLInputElement>(
    'input[type="radio"]:checked',
  )?.parentElement?.textContent;
}
function summary() {
  return container.querySelector('.dt-pagination-summary')?.textContent;
}
function dateButton() {
  return container.querySelector<HTMLButtonElement>(
    '.dt-filter-date-presence button',
  )!;
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

describe('selector de estado dentro del filtro de fecha', () => {
  it('empieza en Todos, solo aparece en Egreso y se combina con la paginación', async () => {
    await render();
    await click('.dt-filter-trigger');
    expect(selected()).toBe('Todos');
    expect(container.querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
    expect(summary()).toContain('de 3');
    const next = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find((item) => item.textContent?.includes('Siguiente'))!;
    await act(() => Promise.resolve(next.click()));
    expect(summary()).toContain('Mostrando 2');
    await select('En base');
    expect(summary()).toContain('Mostrando 1 a 1 de 1');
    expect(container.querySelector('tbody')?.textContent).toContain('ENBASE');
    expect(dateButton().disabled).toBe(true);
    expect(container.querySelector('.dt-button-count')?.textContent).toBe('1');
    await select('Egresados');
    expect(summary()).toContain('de 2');
    expect(dateButton().disabled).toBe(false);
    const clear = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find((item) => item.textContent?.includes('Limpiar'))!;
    await act(() => Promise.resolve(clear.click()));
    expect(selected()).toBe('Todos');
    expect(summary()).toContain('de 3');
    expect(container.querySelector('.dt-button-count')).toBeNull();
  });

  it('restaura fechas antiguas, limpia el rango al elegir En base y no lo recupera al volver', async () => {
    saveTableTemplate(scope, {
      name: 'Fecha anterior',
      config: TableViewConfigSchema.parse({
        filters: [
          {
            id: 'leftAt',
            value: { from: '2026-11-02T00:00:00', to: '2026-11-02T00:00:00' },
          },
        ],
      }),
    });
    await render();
    await click('.dt-filter-trigger');
    expect(selected()).toBe('Todos');
    expect(dateButton().textContent).toContain('2/11');
    expect(summary()).toContain('de 1');
    expect(container.querySelector('tbody')?.textContent).toContain('EGRESADO');
    await select('En base');
    expect(dateButton().textContent).toContain('Elegir fecha');
    await select('Todos');
    expect(dateButton().disabled).toBe(false);
    expect(dateButton().textContent).toContain('Elegir fecha');
    expect(summary()).toContain('de 3');
  });

  it.each(['present', 'missing'])(
    'restaura el estado %s aunque no tenga fecha',
    async (presence) => {
      saveTableTemplate(scope, {
        name: 'Estado',
        config: TableViewConfigSchema.parse({
          filters: [{ id: 'leftAt', value: { presence } }],
        }),
      });
      await render();
      await click('.dt-filter-trigger');
      expect(selected()).toBe(presence === 'missing' ? 'En base' : 'Egresados');
      expect(summary()).toContain(presence === 'missing' ? 'de 1' : 'de 2');
    },
  );
});
