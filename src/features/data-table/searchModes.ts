import type { ColumnDef } from '@tanstack/react-table';
import type { DataTableSearchMode } from './types';

function leafColumns<TData>(
  columns: ColumnDef<TData, unknown>[],
): ColumnDef<TData, unknown>[] {
  return columns.flatMap((column) =>
    'columns' in column && column.columns
      ? leafColumns(column.columns)
      : [column],
  );
}

export function resolveSearchModes<TData>(
  columns: ColumnDef<TData, unknown>[],
  searchableKeys?: string[],
  configured?: readonly DataTableSearchMode<TData>[],
): DataTableSearchMode<TData>[] | undefined {
  let fields = configured?.filter((mode) => mode.id !== 'all');
  if (!fields) {
    const leaves = leafColumns(columns);
    const definitions = new Map<string, ColumnDef<TData, unknown>>();
    for (const column of leaves) {
      if (column.id) definitions.set(column.id, column);
      if ('accessorKey' in column && typeof column.accessorKey === 'string') {
        definitions.set(column.accessorKey, column);
      }
    }
    fields = (searchableKeys ?? []).flatMap((key) => {
      const column = definitions.get(key);
      if (!column || column.enableGlobalFilter === false) return [];
      const label =
        column.meta?.exportHeader ??
        (typeof column.header === 'string' ? column.header : undefined);
      return label?.trim()
        ? [{ id: key, label: label.trim(), searchableKeys: [key] }]
        : [];
    });
  }
  const unique = [
    ...new Map(
      fields.filter((field) => field.id).map((field) => [field.id, field]),
    ).values(),
  ];
  if (unique.length < 2) return undefined;
  return [
    {
      ...configured?.find((mode) => mode.id === 'all'),
      id: 'all',
      label: 'Todos',
    },
    ...unique.map((mode) => ({
      ...mode,
      placeholder:
        mode.placeholder ??
        `Buscar por ${mode.label.toLocaleLowerCase('es-AR')}…`,
    })),
  ];
}
