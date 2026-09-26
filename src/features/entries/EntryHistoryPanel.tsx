import type {
  ColumnDef,
  ColumnFiltersState,
  FilterFn,
} from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  localDb,
  type LocalEntry,
  type LocalInvoice,
  type LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { formatArgentinaDateTime, formatArs } from '../../lib/format/argentina';
import { cashSessionLabel } from '../../lib/format/cashSession';
import {
  readPersistedTableSwitches,
  type TableTemplateScope,
} from '../table-view-template';
import { DataTable, type DataTableFilterOption } from '../data-table';
import { EntryEditDialog } from './EntryEditDialog';
import {
  countInvoiceChips,
  INVOICE_STATE_BADGE,
  INVOICE_STATE_LABEL,
  INVOICE_STATE_ORDER,
  invoiceLetter,
  matchesInvoiceChip,
  resolveInvoiceState,
  voucherLabel,
  type InvoiceChip,
  type InvoiceState,
} from './invoiceUtils';
import { useArcaEmitter } from './useArcaEmitter';

interface Props {
  tenantId: string;
  userId: string;
  accessToken: string;
  actorRole: 'admin' | 'owner' | 'operator' | null;
  initialCashSessionId?: string;
  initialOnlyCurrentSession?: boolean;
  /** Encabezado del ticket al reimprimir desde el diálogo de edición. */
  parkingName?: string | null;
  parkingAddress?: string | null;
  parkingCuit?: string | null;
  onBackToCaja?: () => void;
}

type EntryHistoryRow = LocalEntry & {
  paymentLines: LocalPaymentTransaction[];
  paidTotal: number | null;
  invoice: LocalInvoice | null;
  invoiceState: InvoiceState;
  /** `A` / `B` / `C`, o `''`: filtro «Comprobante». */
  invoiceLetterValue: string;
  /** «Razón social · CUIT» del receptor de la A, o `''`: filtro «Receptor». */
  invoiceReceiver: string;
};

const INVOICE_STATE_OPTIONS: DataTableFilterOption[] = INVOICE_STATE_ORDER.map(
  (state) => ({ value: state, label: INVOICE_STATE_LABEL[state] }),
);
const INVOICE_LETTER_OPTIONS: DataTableFilterOption[] = ['A', 'B', 'C'].map(
  (letter) => ({ value: letter, label: `Factura ${letter}` }),
);
/** Existen para filtrar; se muestran desde el selector de columnas. */
const INITIAL_COLUMN_VISIBILITY = {
  invoiceLetterValue: false,
  invoiceReceiver: false,
  paidTotal: false,
};
const INVOICE_CHIPS: ReadonlyArray<{ id: InvoiceChip; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'unbilled', label: 'Sin facturar' },
  { id: 'error', label: 'Con error' },
];

function receiverLabel(invoice: LocalInvoice | null): string {
  if (!invoice || invoice.receptorDocTipo !== 80) return '';
  const cuit = invoice.receptorDocNro ?? '';
  return invoice.receptorNombre ? `${invoice.receptorNombre} · ${cuit}` : cuit;
}

function InvoiceCell({ row }: { row: EntryHistoryRow }) {
  if (row.invoiceState === 'na') return <span className="muted">—</span>;
  const voucher =
    row.invoice &&
    (row.invoiceState === 'issued' || row.invoiceState === 'issuing')
      ? voucherLabel(row.invoice)
      : null;
  return (
    <div className="entry-invoice-cell">
      <span className={`status-badge ${INVOICE_STATE_BADGE[row.invoiceState]}`}>
        {INVOICE_STATE_LABEL[row.invoiceState]}
      </span>
      {voucher ? <small>{voucher}</small> : null}
    </div>
  );
}

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
    id: 'invoiceState',
    accessorKey: 'invoiceState',
    header: 'Factura',
    size: 170,
    filterFn: 'includesSome',
    cell: ({ row }) => <InvoiceCell row={row.original} />,
  },
  {
    id: 'invoiceLetterValue',
    accessorKey: 'invoiceLetterValue',
    header: 'Comprobante',
    size: 110,
    filterFn: 'includesSome',
    cell: ({ row }) =>
      row.original.invoiceLetterValue ? (
        `Factura ${row.original.invoiceLetterValue}`
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    id: 'invoiceReceiver',
    accessorKey: 'invoiceReceiver',
    header: 'Receptor',
    size: 200,
    filterFn: 'includesSome',
    cell: ({ row }) =>
      row.original.invoiceReceiver || <span className="muted">—</span>,
  },
  {
    id: 'paidTotal',
    accessorFn: (row) => row.paidTotal ?? undefined,
    header: 'Monto',
    size: 110,
    filterFn: 'numberRange',
    cell: ({ row }) =>
      row.original.paidTotal != null ? (
        formatArs(row.original.paidTotal)
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
  'amountPaid',
  'invoiceState',
  'invoiceLetterValue',
  'invoiceReceiver',
  'paidTotal',
  'rateSnapshotName',
  'vehicleBrand',
  'vehicleModel',
  'color',
];

const SEARCHABLE_KEYS = ['plate', 'vehicleBrand', 'vehicleModel', 'notes'];

export function EntryHistoryPanel({
  tenantId,
  userId,
  accessToken,
  actorRole,
  initialCashSessionId,
  initialOnlyCurrentSession = false,
  parkingName = null,
  parkingAddress = null,
  parkingCuit = null,
  onBackToCaja,
}: Props) {
  const tableScope = useMemo<TableTemplateScope>(
    () => ({ userId, tenantId, tableKey: 'entry-history' }),
    [tenantId, userId],
  );
  const persistedSwitches = useMemo(
    () => readPersistedTableSwitches(tableScope),
    [tableScope],
  );
  const focusedFromCashSession = Boolean(
    initialCashSessionId || initialOnlyCurrentSession,
  );
  const isOperator = actorRole === 'operator';
  const [onlyCurrentSession, setOnlyCurrentSession] = useState(() =>
    isOperator
      ? true
      : focusedFromCashSession
        ? initialOnlyCurrentSession
        : (persistedSwitches.onlyCurrentSession ?? true),
  );
  const [includeInLot, setIncludeInLot] = useState(
    () => persistedSwitches.includeInLot ?? true,
  );
  const [editingEntry, setEditingEntry] = useState<EntryHistoryRow | null>(
    null,
  );
  const [invoiceChip, setInvoiceChip] = useState<InvoiceChip>('all');
  const { isOnline } = useNetwork();
  const emitter = useArcaEmitter(tenantId, accessToken, isOnline);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnFiltersOverride, setColumnFiltersOverride] =
    useState<ColumnFiltersState>([]);
  const [columnFiltersOverrideKey, setColumnFiltersOverrideKey] = useState(0);

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

  const filterableColumns = useMemo(
    () =>
      isOperator
        ? FILTERABLE_COLUMNS.filter((column) => column !== 'cashSessionId')
        : FILTERABLE_COLUMNS,
    [isOperator],
  );

  const initialColumnFilters = useMemo<ColumnFiltersState>(
    () =>
      initialCashSessionId && !isOperator
        ? [{ id: 'cashSessionId', value: [initialCashSessionId] }]
        : [],
    [initialCashSessionId, isOperator],
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

  const allInvoices = useLiveQuery(
    () => localDb.invoices.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  const entries = useMemo(() => {
    if (!allEntries || !allPaymentTransactions || !allInvoices) {
      return undefined;
    }
    const invoiceByEntryId = new Map(
      allInvoices.map((invoice) => [invoice.entryId, invoice]),
    );

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
      .map<EntryHistoryRow>((entry) => {
        const paymentLines = paymentsByEntryId.get(entry.id) ?? [];
        const paidTotal =
          paymentLines.length > 0
            ? paymentLines.reduce((total, line) => total + line.amount, 0)
            : entry.amountPaid != null
              ? parseFloat(entry.amountPaid)
              : null;
        const invoice = invoiceByEntryId.get(entry.id) ?? null;
        const invoiceState = resolveInvoiceState(
          {
            leftAt: entry.leftAt,
            paidTotal,
            manuallyInvoiced: entry.manuallyInvoiced,
          },
          invoice ?? undefined,
        );
        // Letra y receptor sólo de un comprobante real o por emitir.
        const countsAsVoucher =
          invoiceState !== 'none' &&
          invoiceState !== 'na' &&
          invoiceState !== 'manual';
        return {
          ...entry,
          paymentLines,
          paidTotal,
          invoice,
          invoiceState,
          invoiceLetterValue: countsAsVoucher
            ? invoiceLetter(invoice?.cbteTipo)
            : '',
          invoiceReceiver: countsAsVoucher ? receiverLabel(invoice) : '',
        };
      })
      .sort(
        (a, b) =>
          new Date(b.leftAt ?? b.enteredAt).getTime() -
          new Date(a.leftAt ?? a.enteredAt).getTime(),
      );
  }, [
    allEntries,
    allPaymentTransactions,
    allInvoices,
    includeInLot,
    onlyCurrentSession,
    activeCashSession,
  ]);

  const chipCounts = useMemo(() => countInvoiceChips(entries ?? []), [entries]);
  const visibleEntries = useMemo(
    () =>
      invoiceChip === 'all'
        ? entries
        : entries?.filter((row) =>
            matchesInvoiceChip(row.invoiceState, invoiceChip),
          ),
    [entries, invoiceChip],
  );

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
  const tableSwitches = useMemo(
    () => ({
      onlyCurrentSession: isOperator ? true : onlyCurrentSession,
      includeInLot,
    }),
    [includeInLot, isOperator, onlyCurrentSession],
  );

  useEffect(() => {
    if (!isOperator) return;
    setOnlyCurrentSession(true);
    setColumnFiltersOverride(
      columnFilters.filter((filter) => filter.id !== 'cashSessionId'),
    );
    setColumnFiltersOverrideKey((current) => current + 1);
  }, [columnFilters, isOperator]);

  const handleColumnFiltersChange = useCallback(
    (filters: ColumnFiltersState) => {
      const nextFilters = isOperator
        ? filters.filter((filter) => filter.id !== 'cashSessionId')
        : filters;
      setColumnFilters(nextFilters);
      if (isOperator) {
        setOnlyCurrentSession(true);
        if (nextFilters.length !== filters.length) {
          setColumnFiltersOverride(nextFilters);
          setColumnFiltersOverrideKey((current) => current + 1);
        }
        return;
      }
      const cashSessionFilter = filters.find(
        (filter) => filter.id === 'cashSessionId',
      );
      const selectedCashSessionIds = Array.isArray(cashSessionFilter?.value)
        ? cashSessionFilter.value.map(String)
        : [];
      if (selectedCashSessionIds.length > 0) {
        setOnlyCurrentSession(false);
      }
    },
    [isOperator],
  );

  function handleOnlyCurrentSessionChange(next: boolean) {
    if (isOperator) {
      setOnlyCurrentSession(true);
      return;
    }

    setOnlyCurrentSession(next);
    if (!next) return;

    setColumnFiltersOverride(
      columnFilters.filter((filter) => filter.id !== 'cashSessionId'),
    );
    setColumnFiltersOverrideKey((current) => current + 1);
  }

  return (
    <>
      <DataTable
        data={visibleEntries ?? []}
        columns={columns}
        isLoading={visibleEntries === undefined}
        emptyMessage="No hay movimientos registrados todavía."
        searchPlaceholder="Buscar por patente, vehículo o notas…"
        searchableKeys={SEARCHABLE_KEYS}
        filterableColumns={filterableColumns}
        filterOptionsByColumn={{
          amountPaid: paymentMethodFilterOptions,
          cashSessionId: cashSessionFilterOptions,
          invoiceState: INVOICE_STATE_OPTIONS,
          invoiceLetterValue: INVOICE_LETTER_OPTIONS,
        }}
        initialColumnVisibility={INITIAL_COLUMN_VISIBILITY}
        toolbarExtra={
          <div
            className="entry-invoice-chips"
            role="group"
            aria-label="Facturación"
          >
            {INVOICE_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="entry-invoice-chip"
                aria-pressed={invoiceChip === chip.id}
                onClick={() => setInvoiceChip(chip.id)}
              >
                {chip.label}
                {chip.id === 'all' ? null : <b>{chipCounts[chip.id]}</b>}
              </button>
            ))}
          </div>
        }
        initialColumnFilters={initialColumnFilters}
        onColumnFiltersChange={handleColumnFiltersChange}
        columnFiltersOverride={columnFiltersOverride}
        columnFiltersOverrideKey={columnFiltersOverrideKey}
        initialColumnFiltersOverridePersistedState={focusedFromCashSession}
        initialPageSize={20}
        pageSizeOptions={[10, 20, 50, 100]}
        getRowId={(row) => row.id}
        onRowClick={(row) => setEditingEntry(row)}
        templateScope={tableScope}
        persistState
        persistentSwitches={tableSwitches}
        filterSwitches={[
          {
            id: 'onlyCurrentSession',
            label: 'Solo caja actual',
            checked: isOperator ? true : onlyCurrentSession,
            disabled: isOperator,
            onChange: handleOnlyCurrentSessionChange,
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
          parkingName={parkingName}
          parkingAddress={parkingAddress}
          parkingCuit={parkingCuit}
          emitter={emitter}
          onClose={() => setEditingEntry(null)}
        />
      ) : null}
    </>
  );
}
