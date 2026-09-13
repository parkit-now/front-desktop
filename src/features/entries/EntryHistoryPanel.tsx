import type {
  ColumnDef,
  ColumnFiltersState,
  FilterFn,
} from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  localDb,
  type LocalEntry,
  type LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { formatArgentinaDateTime, formatArs } from '../../lib/format/argentina';
import { cashSessionLabel } from '../../lib/format/cashSession';
import { DataTable, type DataTableFilterOption } from '../data-table';
import { EntryEditDialog } from './EntryEditDialog';

interface Props {
  tenantId: string;
  userId: string;
  accessToken: string;
  actorRole: 'admin' | 'owner' | 'operator' | null;
  initialCashSessionId?: string;
  initialOnlyCurrentSession?: boolean;
  onBackToCaja?: () => void;
}

type EntryHistoryRow = LocalEntry & {
  paymentLines: LocalPaymentTransaction[];
};

function dateOnly(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

function paymentMethodFilterValue(line: LocalPaymentTransaction): string {
  return line.paymentMethodId ?? line.paymentMethodName;
}

const paymentMethodFilter: FilterFn<EntryHistoryRow> = (
  row,
  _columnId,
  value,
) => {
  if (!Array.isArray(value) || value.length === 0) return true;
  const selected = new Set(value.map(String));

  return row.original.paymentLines.some((line) =>
    selected.has(paymentMethodFilterValue(line)),
  );
};

function buildCashSessionColumn(
  sessionLabelById: Map<string, string>,
): ColumnDef<EntryHistoryRow, unknown> {
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

const COLUMNS_HEAD: ColumnDef<EntryHistoryRow, unknown>[] = [
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

const COLUMNS_TAIL: ColumnDef<EntryHistoryRow, unknown>[] = [
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
    accessorFn: (row) => {
      if (row.paymentLines.length > 0) {
        return row.paymentLines.reduce((total, line) => total + line.amount, 0);
      }
      return row.amountPaid != null ? parseFloat(row.amountPaid) : null;
    },
    header: 'Cobrado',
    size: 170,
    filterFn: paymentMethodFilter,
    meta: {
      filterLabel: 'Medio de pago',
    },
    cell: ({ row }) => {
      const { paymentLines } = row.original;

      if (paymentLines.length > 0) {
        return (
          <div className="entry-payment-breakdown">
            {paymentLines.map((line) => (
              <div className="entry-payment-line" key={line.id}>
                <span>{line.paymentMethodName}</span>
                <strong>{formatArs(line.amount)}</strong>
              </div>
            ))}
          </div>
        );
      }

      return row.original.amountPaid ? (
        formatArs(row.original.amountPaid)
      ) : (
        <span className="muted">—</span>
      );
    },
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
  'amountPaid',
  'rateSnapshotName',
  'vehicleBrand',
  'vehicleModel',
  'color',
];

const SEARCHABLE_KEYS = ['plate', 'notes'];

export function EntryHistoryPanel({
  tenantId,
  userId,
  accessToken,
  actorRole,
  initialCashSessionId,
  initialOnlyCurrentSession = false,
  onBackToCaja,
}: Props) {
  const [onlyCurrentSession, setOnlyCurrentSession] = useState(
    initialOnlyCurrentSession,
  );
  const [includeInLot, setIncludeInLot] = useState(false);
  const [editingEntry, setEditingEntry] = useState<EntryHistoryRow | null>(
    null,
  );

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

  const allPaymentTransactions = useLiveQuery(
    () =>
      localDb.paymentTransactions.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  const entries = useMemo(() => {
    if (!allEntries || !allPaymentTransactions) return undefined;

    const paymentsByEntryId = new Map<string, LocalPaymentTransaction[]>();
    allPaymentTransactions
      .filter((tx) => !tx.deletedAt)
      .forEach((tx) => {
        const lines = paymentsByEntryId.get(tx.entryId);
        if (lines) {
          lines.push(tx);
        } else {
          paymentsByEntryId.set(tx.entryId, [tx]);
        }
      });

    let filtered = includeInLot
      ? allEntries
      : allEntries.filter((e) => Boolean(e.leftAt));

    if (onlyCurrentSession) {
      filtered = activeCashSession
        ? filtered.filter((e) => e.cashSessionId === activeCashSession.id)
        : [];
    }

    return filtered
      .map<EntryHistoryRow>((entry) => ({
        ...entry,
        paymentLines: paymentsByEntryId.get(entry.id) ?? [],
      }))
      .sort(
        (a, b) =>
          new Date(b.leftAt ?? b.enteredAt).getTime() -
          new Date(a.leftAt ?? a.enteredAt).getTime(),
      );
  }, [
    allEntries,
    allPaymentTransactions,
    includeInLot,
    onlyCurrentSession,
    activeCashSession,
  ]);

  const paymentMethodFilterOptions = useMemo<DataTableFilterOption[]>(() => {
    if (!allPaymentTransactions) return [];

    const byValue = new Map<string, string>();
    allPaymentTransactions
      .filter((tx) => !tx.deletedAt)
      .forEach((tx) => {
        byValue.set(paymentMethodFilterValue(tx), tx.paymentMethodName);
      });

    return Array.from(byValue.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'es'));
  }, [allPaymentTransactions]);

  const editingCashSession = editingEntry?.cashSessionId
    ? allSessions?.find((session) => session.id === editingEntry.cashSessionId)
    : undefined;

  return (
    <>
      <DataTable
        data={entries ?? []}
        columns={columns}
        isLoading={entries === undefined}
        emptyMessage="No hay movimientos registrados todavía."
        searchPlaceholder="Buscar por patente o notas…"
        searchableKeys={SEARCHABLE_KEYS}
        filterableColumns={FILTERABLE_COLUMNS}
        filterOptionsByColumn={{
          amountPaid: paymentMethodFilterOptions,
          cashSessionId: cashSessionFilterOptions,
        }}
        initialColumnFilters={initialColumnFilters}
        initialPageSize={20}
        pageSizeOptions={[10, 20, 50, 100]}
        getRowId={(row) => row.id}
        onRowClick={(row) => setEditingEntry(row)}
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
            : initialOnlyCurrentSession
              ? 'Mostrando los movimientos de la caja activa.'
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
      {editingEntry ? (
        <EntryEditDialog
          entry={editingEntry}
          tenantId={tenantId}
          accessToken={accessToken}
          actorRole={actorRole}
          cashSession={editingCashSession}
          onClose={() => setEditingEntry(null)}
        />
      ) : null}
    </>
  );
}
