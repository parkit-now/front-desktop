import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { formatArgentinaDateTime, formatArs } from '../../lib/format/argentina';
import { DataTable } from '../data-table';

interface Props {
  tenantId: string;
  userId: string;
}

function dateOnly(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

const COLUMNS: ColumnDef<LocalEntry, unknown>[] = [
  {
    accessorKey: 'plate',
    header: 'Patente',
    size: 100,
    cell: ({ row }) => <strong>{row.original.plate}</strong>,
  },
  {
    accessorKey: 'vehicleBrand',
    header: 'Marca',
    size: 110,
    cell: ({ row }) =>
      row.original.vehicleBrand ? (
        row.original.vehicleBrand
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    accessorKey: 'vehicleModel',
    header: 'Modelo',
    size: 120,
    cell: ({ row }) =>
      row.original.vehicleModel ? (
        row.original.vehicleModel
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    accessorKey: 'color',
    header: 'Color',
    size: 90,
    cell: ({ row }) =>
      row.original.color ? (
        row.original.color
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    id: 'enteredAt',
    accessorFn: (row) => dateOnly(row.enteredAt),
    header: 'Ingreso',
    size: 155,
    filterFn: 'dateRange',
    cell: ({ row }) => formatArgentinaDateTime(row.original.enteredAt),
  },
  {
    id: 'leftAt',
    accessorFn: (row) => dateOnly(row.leftAt),
    header: 'Egreso',
    size: 155,
    filterFn: 'dateRange',
    cell: ({ row }) =>
      row.original.leftAt ? (
        formatArgentinaDateTime(row.original.leftAt)
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    accessorKey: 'rateSnapshotName',
    header: 'Tarifa',
    size: 140,
    cell: ({ row }) =>
      row.original.rateSnapshotName ? (
        row.original.rateSnapshotName
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    id: 'amountPaid',
    accessorFn: (row) =>
      row.amountPaid != null ? parseFloat(row.amountPaid) : null,
    header: 'Cobrado',
    size: 100,
    enableColumnFilter: false,
    cell: ({ row }) =>
      row.original.amountPaid ? (
        formatArs(row.original.amountPaid)
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    accessorKey: 'cochera',
    header: 'Cochera',
    size: 85,
    cell: ({ row }) =>
      row.original.cochera ? (
        row.original.cochera
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    accessorKey: 'notes',
    header: 'Notas',
    size: 220,
    cell: ({ row }) =>
      row.original.notes ? (
        row.original.notes
      ) : (
        <span className="muted">—</span>
      ),
  },
];

const FILTERABLE_COLUMNS = [
  'enteredAt',
  'leftAt',
  'rateSnapshotName',
  'vehicleBrand',
  'vehicleModel',
  'color',
];

const SEARCHABLE_KEYS = ['plate', 'notes'];

export function EntryHistoryPanel({ tenantId, userId }: Props) {
  const [onlyCurrentSession, setOnlyCurrentSession] = useState(false);
  const [includeInLot, setIncludeInLot] = useState(false);

  const activeCashSession = useLiveQuery(
    () =>
      localDb.cashSessions
        .where('tenantId')
        .equals(tenantId)
        .filter((s) => !s.closedAt)
        .first(),
    [tenantId],
  );

  const allEntries = useLiveQuery(
    () => localDb.entries.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  const entries = useMemo(() => {
    if (!allEntries) return undefined;

    let filtered = includeInLot
      ? allEntries
      : allEntries.filter((e) => Boolean(e.leftAt));

    if (onlyCurrentSession) {
      filtered = activeCashSession
        ? filtered.filter((e) => e.cashSessionId === activeCashSession.id)
        : [];
    }

    return [...filtered].sort(
      (a, b) =>
        new Date(b.leftAt ?? b.enteredAt).getTime() -
        new Date(a.leftAt ?? a.enteredAt).getTime(),
    );
  }, [allEntries, includeInLot, onlyCurrentSession, activeCashSession]);

  return (
    <DataTable
      data={entries ?? []}
      columns={COLUMNS}
      isLoading={entries === undefined}
      emptyMessage="No hay movimientos registrados todavía."
      searchPlaceholder="Buscar por patente o notas…"
      searchableKeys={SEARCHABLE_KEYS}
      filterableColumns={FILTERABLE_COLUMNS}
      initialPageSize={20}
      pageSizeOptions={[10, 20, 50, 100]}
      getRowId={(row) => row.id}
      templateScope={{ userId, tenantId, tableKey: 'entry-history' }}
      filterSwitches={[
        {
          id: 'onlyCurrentSession',
          label: 'Solo caja actual',
          checked: onlyCurrentSession,
          onChange: setOnlyCurrentSession,
        },
        {
          id: 'includeInLot',
          label: 'Incluir autos en base',
          checked: includeInLot,
          onChange: setIncludeInLot,
        },
      ]}
    />
  );
}
