import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { formatArgentinaDateTime, formatArs } from '../../lib/format/argentina';
import { cashSessionLabel } from '../../lib/format/cashSession';
import { DataTable, type DataTableFilterOption } from '../data-table';

interface Props {
  tenantId: string;
  userId: string;
  initialCashSessionId?: string;
  onBackToCaja?: () => void;
}

function dateOnly(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

function buildCashSessionColumn(
  sessionLabelById: Map<string, string>,
): ColumnDef<LocalEntry, unknown> {
  return {
    id: 'cashSessionId',
    accessorFn: (row) => row.cashSessionId ?? '',
    header: 'Caja',
    size: 190,
    filterFn: 'includesSome',
    cell: ({ row }) => {
      const cashSessionId = row.original.cashSessionId;
      const label = cashSessionId ? sessionLabelById.get(cashSessionId) : null;
      return label ? label : <span className="muted">—</span>;
    },
  };
}

const COLUMNS_HEAD: ColumnDef<LocalEntry, unknown>[] = [
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
];

const COLUMNS_TAIL: ColumnDef<LocalEntry, unknown>[] = [
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
  'cashSessionId',
  'rateSnapshotName',
  'vehicleBrand',
  'vehicleModel',
  'color',
];

const SEARCHABLE_KEYS = ['plate', 'notes'];

export function EntryHistoryPanel({
  tenantId,
  userId,
  initialCashSessionId,
  onBackToCaja,
}: Props) {
  const [onlyCurrentSession, setOnlyCurrentSession] = useState(false);
  const [includeInLot, setIncludeInLot] = useState(false);

  const allSessions = useLiveQuery(
    () =>
      localDb.cashSessions
        .where('tenantId')
        .equals(tenantId)
        .toArray()
        .then((arr) =>
          arr.sort(
            (a, b) =>
              new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
          ),
        ),
    [tenantId],
  );

  const activeCashSession = useMemo(
    () => allSessions?.find((s) => !s.closedAt),
    [allSessions],
  );

  const sessionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (allSessions ?? []).forEach((s) => map.set(s.id, cashSessionLabel(s)));
    return map;
  }, [allSessions]);

  const cashSessionFilterOptions = useMemo<DataTableFilterOption[]>(
    () =>
      (allSessions ?? []).map((s) => ({
        value: s.id,
        label: cashSessionLabel(s),
      })),
    [allSessions],
  );

  const columns = useMemo(
    () => [
      ...COLUMNS_HEAD,
      buildCashSessionColumn(sessionLabelById),
      ...COLUMNS_TAIL,
    ],
    [sessionLabelById],
  );

  const initialColumnFilters = useMemo<ColumnFiltersState>(
    () =>
      initialCashSessionId
        ? [{ id: 'cashSessionId', value: [initialCashSessionId] }]
        : [],
    [initialCashSessionId],
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
      columns={columns}
      isLoading={entries === undefined}
      emptyMessage="No hay movimientos registrados todavía."
      searchPlaceholder="Buscar por patente o notas…"
      searchableKeys={SEARCHABLE_KEYS}
      filterableColumns={FILTERABLE_COLUMNS}
      filterOptionsByColumn={{ cashSessionId: cashSessionFilterOptions }}
      initialColumnFilters={initialColumnFilters}
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
      subtitle={
        initialCashSessionId
          ? 'Mostrando los movimientos de la caja seleccionada.'
          : undefined
      }
      headerAction={
        onBackToCaja ? (
          <button
            type="button"
            className="dt-secondary-action"
            onClick={onBackToCaja}
          >
            <ArrowLeft size={15} />
            Volver a Caja
          </button>
        ) : undefined
      }
    />
  );
}
