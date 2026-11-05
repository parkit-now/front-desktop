import type { ColumnDef } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';
import { resolveSearchModes } from './searchModes';
import { createVehicleSearchModes } from './vehicleSearch';

type Row = { name: string; email: string; plate: string; notes?: string };
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'Nombre' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'plate', header: 'Patente' },
  { id: 'actions', header: 'Acciones' },
];

describe('opciones de búsqueda por campo', () => {
  it('genera Todos primero y usa solo los campos de búsqueda habilitados', () => {
    const modes = resolveSearchModes(columns, ['name', 'email']);
    expect(modes?.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'all', label: 'Todos' },
      { id: 'name', label: 'Nombre' },
      { id: 'email', label: 'Email' },
    ]);
    expect(modes?.[1]).toMatchObject({
      searchableKeys: ['name'],
      placeholder: 'Buscar por nombre…',
    });
  });

  it('no convierte las columnas en opciones si no hay campos buscables definidos', () => {
    expect(resolveSearchModes(columns)).toBeUndefined();
    expect(resolveSearchModes(columns, [])).toBeUndefined();
  });

  it('no agrega selector cuando solo se puede buscar un campo', () => {
    expect(resolveSearchModes(columns, ['name'])).toBeUndefined();
    expect(resolveSearchModes(columns.slice(0, 1))).toBeUndefined();
  });

  it('no publica campos deshabilitados ni nombres internos sin etiqueta', () => {
    expect(
      resolveSearchModes(
        [
          ...columns,
          { accessorKey: 'notes', header: 'Notas', enableGlobalFilter: false },
          { id: 'privateSearch', accessorFn: () => 'interno' },
        ],
        ['name', 'email', 'plate', 'notes', 'privateSearch'],
      )?.map((mode) => mode.id),
    ).toEqual(['all', 'name', 'email', 'plate']);
  });

  it('admite grupos de columnas y campos con un id distinto del accessor', () => {
    expect(
      resolveSearchModes(
        [
          {
            header: 'Contacto',
            columns: [
              { id: 'person', accessorKey: 'name', header: 'Nombre' },
              { accessorKey: 'email', header: 'Email' },
            ],
          },
        ],
        ['name', 'email'],
      )?.map((mode) => mode.id),
    ).toEqual(['all', 'name', 'email']);
  });

  it('respeta los modos explícitos, elimina duplicados y conserva sus identificadores', () => {
    const modes = resolveSearchModes(columns, undefined, [
      { id: 'name', label: 'Nombre', searchableKeys: ['name'] },
      { id: 'email', label: 'Email', searchableKeys: ['email'] },
      { id: 'email', label: 'Email', searchableKeys: ['email'] },
    ]);
    expect(modes?.map((mode) => mode.id)).toEqual(['all', 'name', 'email']);
  });

  it('conserva la coincidencia especial de patentes al sumar otros campos', () => {
    const configured = createVehicleSearchModes<Row>({
      plate: (row) => row.plate,
      fields: [{ id: 'email', label: 'Email', searchableKeys: ['email'] }],
    });
    const modes = resolveSearchModes(columns, ['plate', 'email'], configured)!;
    expect(modes.map((mode) => mode.id)).toEqual(['all', 'plate', 'email']);
    expect(
      modes[1].matches!(
        { name: 'Ana', email: 'otro@test.com', plate: 'AB123CD' },
        'ab123',
      ),
    ).toBe(true);
  });
});
