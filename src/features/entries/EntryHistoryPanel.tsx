import type {
  ColumnDef,
  ColumnFiltersState,
  FilterFn,
} from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Eye } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  localDb,
  type LocalEntry,
  type LocalInvoice,
  type LocalLprDetectionEvent,
  type LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useToast } from '../../lib/notifications/ToastProvider';
import { translateApiError } from '../../lib/api/translate';
import { formatArgentinaDateTime, formatArs } from '../../lib/format/argentina';
import { cashSessionLabel } from '../../lib/format/cashSession';
import {
  readPersistedTableSwitches,
  type TableTemplateScope,
} from '../table-view-template';
import { DataTable, type DataTableFilterOption } from '../data-table';
import { dateTimeSorting } from '../data-table/utils';
import { getDateRangeExcelFileName } from '../data-table/excelExport';
import { EntryEditDialog } from './EntryEditDialog';
import {
  INVOICE_STATE_BADGE,
  INVOICE_STATE_LABEL,
  INVOICE_STATE_ORDER,
  invoiceLetter,
  receiverDescription,
  resolveInvoiceState,
  voucherLabel,
  type InvoiceState,
} from './invoiceUtils';
import { useArcaEmitter } from './useArcaEmitter';
import { DetectionImageDialog } from '../camera/DetectionImageDialog';

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
  lprDetection: LocalLprDetectionEvent | null;
  invoiceState: InvoiceState;
  /** `A` / `B` / `C`, o `''`: filtro «Comprobante». */
  invoiceLetterValue: string;
  /** «Razón social · CUIT» del receptor de la A, o `''`: filtro «Receptor». */
  invoiceReceiver: string;
};

/** Existen para filtrar; se muestran desde el selector de columnas. */
const INITIAL_COLUMN_VISIBILITY = {
  invoiceLetterValue: false,
  invoiceReceiver: false,
};
function receiverLabel(invoice: LocalInvoice | null): string {
  if (!invoice || invoice.receptorDocTipo !== 80) return '';
  return receiverDescription(invoice);
}

function invoiceExportValue(row: EntryHistoryRow): string {
  if (row.invoiceState === 'na') return '';
  const invoice =
    row.invoiceState === 'issued' || row.invoiceState === 'issuing'
      ? row.invoice
      : null;
  const letter = invoiceLetter(invoice?.cbteTipo);
  const number =
    invoice?.ptoVta != null && invoice.cbteNro != null
      ? `${String(invoice.ptoVta).padStart(4, '0')}-${String(invoice.cbteNro).padStart(8, '0')}`
      : null;
  return [
    INVOICE_STATE_LABEL[row.invoiceState],
    letter ? `Factura ${letter}` : invoice ? voucherLabel(invoice) : null,
    number,
  ]
    .filter(Boolean)
    .join('\n');
}

function InvoiceCell({ row }: { row: EntryHistoryRow }) {
  if (row.invoiceState === 'na') return <span className="muted">—</span>;
  const invoice =
    row.invoice &&
    (row.invoiceState === 'issued' || row.invoiceState === 'issuing')
      ? row.invoice
      : null;
  const letter = invoiceLetter(invoice?.cbteTipo);
  const voucherNumber =
    invoice?.ptoVta != null && invoice.cbteNro != null
      ? `${String(invoice.ptoVta).padStart(4, '0')}-${String(invoice.cbteNro).padStart(8, '0')}`
      : null;
  const voucher = invoice ? voucherLabel(invoice) : null;
  return (
    <div className="entry-invoice-cell">
      <span className={`status-badge ${INVOICE_STATE_BADGE[row.invoiceState]}`}>
        {INVOICE_STATE_LABEL[row.invoiceState]}
      </span>
      {letter ? (
        <span className="entry-invoice-line">Factura {letter}</span>
      ) : voucher ? (
        <span className="entry-invoice-line">{voucher}</span>
      ) : null}
      {voucherNumber ? (
        <span className="entry-invoice-number">{voucherNumber}</span>
      ) : null}
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
  sessionOpenedAtById: Map<string, string>,
): ColumnDef<EntryHistoryRow, unknown> {
  return {
    id: 'cashSessionId',
    accessorFn: (row) => row.cashSessionId ?? '',
    header: 'Caja',
    meta: {
      exportValue: (row) => sessionLabelById.get(row.cashSessionId ?? '') ?? '',
    },
    size: 190,
    filterFn: 'includesSome',
    sortingFn: dateTimeSorting((row) =>
      sessionOpenedAtById.get(row.cashSessionId ?? ''),
    ),
    cell: ({ row }) => {
      const cashSessionId = row.original.cashSessionId;
      const label = cashSessionId ? sessionLabelById.get(cashSessionId) : null;
      return label ? label : <span className="muted">—</span>;
    },
  };
}

function buildPhotoColumn(
  onOpen: (detection: LocalLprDetectionEvent) => void,
): ColumnDef<EntryHistoryRow, unknown> {
  return {
    id: 'photo',
    meta: {
      excludeFromExport: true,
    },
    header: '',
    size: 42,
    enableSorting: false,
    enableHiding: false,
    cell: ({ row }) => {
      const detection = row.original.lprDetection;
      const disabled = !detection?.bestCaptureId;
      return (
        <button
          type="button"
          className="entry-photo-button"
          disabled={disabled}
          title={
            disabled
              ? 'Este ingreso no tiene foto'
              : `Ver foto de ${row.original.plate}`
          }
          aria-label={
            disabled
              ? 'Este ingreso no tiene foto'
              : `Ver foto de ${row.original.plate}`
          }
          onClick={(event) => {
            event.stopPropagation();
            if (detection?.bestCaptureId) onOpen(detection);
          }}
        >
          <Eye size={16} aria-hidden="true" />
        </button>
      );
    },
  };
}

const COLUMNS_HEAD: ColumnDef<EntryHistoryRow, unknown>[] = [
  {
    accessorKey: 'ticketNumber',
    header: '#',
    size: 64,
    cell: ({ row }) =>
      row.original.ticketNumber != null ? (
        <span className="vehicle-ticket-badge">
          #{row.original.ticketNumber}
        </span>
      ) : (
        <span className="muted">—</span>
      ),
  },
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
    id: 'enteredAt',
    accessorFn: (row) => dateOnly(row.enteredAt),
    header: 'Ingreso',
    meta: { exportValue: (row) => formatArgentinaDateTime(row.enteredAt) },
    size: 155,
    filterFn: 'dateRange',
    sortingFn: dateTimeSorting((row) => row.enteredAt),
    cell: ({ row }) => formatArgentinaDateTime(row.original.enteredAt),
  },
  {
    id: 'leftAt',
    accessorFn: (row) => dateOnly(row.leftAt),
    header: 'Egreso',
    meta: {
      exportValue: (row) =>
        row.leftAt ? formatArgentinaDateTime(row.leftAt) : '',
    },
    size: 155,
    filterFn: 'dateRange',
    sortingFn: dateTimeSorting((row) => row.leftAt),
    cell: ({ row }) =>
      row.original.leftAt ? (
        formatArgentinaDateTime(row.original.leftAt)
      ) : (
        <span className="muted">—</span>
      ),
  },
];

const AMOUNT_PAID_COLUMN: ColumnDef<EntryHistoryRow, unknown> = {
  id: 'amountPaid',
  accessorFn: (row) => {
    if (row.paymentLines.length > 0) {
      return row.paymentLines.reduce((total, line) => total + line.amount, 0);
    }
    return row.amountPaid != null ? parseFloat(row.amountPaid) : null;
  },
  header: 'Cobrado',
  size: 155,
  filterFn: paymentMethodFilter,
  meta: {
    filterLabel: 'Medio de pago',
    exportValue: (row) =>
      row.paidTotal == null
        ? ''
        : [
            formatArs(row.paidTotal),
            row.paymentLines.length > 0
              ? row.paymentLines
                  .map((line) => line.paymentMethodName)
                  .join(' + ')
              : 'Sin medio',
          ].join('\n'),
  },
  cell: ({ row }) => {
    const { paidTotal, paymentLines } = row.original;

    if (paidTotal == null) {
      return <span className="muted">—</span>;
    }

    const methodLabel =
      paymentLines.length > 0
        ? paymentLines.map((line) => line.paymentMethodName).join(' + ')
        : 'Sin medio';
    const breakdown =
      paymentLines.length > 1
        ? paymentLines
            .map(
              (line) => `${line.paymentMethodName}: ${formatArs(line.amount)}`,
            )
            .join(' · ')
        : methodLabel;

    return (
      <div className="entry-payment-summary" title={breakdown}>
        <strong>{formatArs(paidTotal)}</strong>
        <span>{methodLabel}</span>
      </div>
    );
  },
};

const INVOICE_COLUMNS: ColumnDef<EntryHistoryRow, unknown>[] = [
  {
    id: 'invoiceState',
    accessorKey: 'invoiceState',
    header: 'Factura',
    meta: { exportValue: invoiceExportValue },
    size: 170,
    filterFn: 'includesSome',
    cell: ({ row }) => <InvoiceCell row={row.original} />,
  },
  {
    id: 'invoiceLetterValue',
    accessorKey: 'invoiceLetterValue',
    header: 'Comprobante',
    meta: {
      exportValue: (row) =>
        row.invoiceLetterValue ? `Factura ${row.invoiceLetterValue}` : '',
    },
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
];

const FILTERABLE_COLUMNS = [
  'enteredAt',
  'leftAt',
  'cashSessionId',
  'amountPaid',
  'invoiceState',
  'invoiceLetterValue',
  'invoiceReceiver',
  'rateSnapshotName',
  'vehicleBrand',
  'vehicleModel',
  'color',
];

const SEARCHABLE_KEYS = [
  'ticketNumber',
  'plate',
  'vehicleBrand',
  'vehicleModel',
  'invoiceReceiver',
  'notes',
];

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
  const { showToast } = useToast();
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
  const { isOnline } = useNetwork();
  const emitter = useArcaEmitter(tenantId, accessToken, isOnline);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnFiltersOverride, setColumnFiltersOverride] =
    useState<ColumnFiltersState>([]);
  const [columnFiltersOverrideKey, setColumnFiltersOverrideKey] = useState(0);
  const [photoDetection, setPhotoDetection] =
    useState<LocalLprDetectionEvent | null>(null);

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

  const sessionOpenedAtById = useMemo(
    () => new Map((allSessions ?? []).map((s) => [s.id, s.openedAt])),
    [allSessions],
  );

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
      buildPhotoColumn(setPhotoDetection),
      ...COLUMNS_HEAD,
      AMOUNT_PAID_COLUMN,
      ...INVOICE_COLUMNS,
      buildCashSessionColumn(sessionLabelById, sessionOpenedAtById),
      ...COLUMNS_TAIL,
    ],
    [sessionLabelById, sessionOpenedAtById],
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

  const allLprDetections = useLiveQuery(
    () =>
      localDb.lprDetectionEvents.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  const entries = useMemo(() => {
    if (
      !allEntries ||
      !allPaymentTransactions ||
      !allInvoices ||
      !allLprDetections
    ) {
      return undefined;
    }
    const invoiceByEntryId = new Map(
      allInvoices.map((invoice) => [invoice.entryId, invoice]),
    );
    const detectionByEntryId = new Map<string, LocalLprDetectionEvent>();
    allLprDetections
      .filter(
        (event) =>
          event.entryId && event.bestCaptureId && !event.imageDeletedAt,
      )
      .sort(
        (a, b) =>
          new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
      )
      .forEach((event) => {
        if (event.entryId && !detectionByEntryId.has(event.entryId)) {
          detectionByEntryId.set(event.entryId, event);
        }
      });

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
          lprDetection: detectionByEntryId.get(entry.id) ?? null,
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
    allLprDetections,
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

  const invoiceStateFilterOptions = useMemo<DataTableFilterOption[]>(() => {
    const states = new Set((entries ?? []).map((row) => row.invoiceState));
    return INVOICE_STATE_ORDER.filter((state) => states.has(state)).map(
      (state) => ({
        value: state,
        label: INVOICE_STATE_LABEL[state],
      }),
    );
  }, [entries]);

  const invoiceLetterFilterOptions = useMemo<DataTableFilterOption[]>(() => {
    const letters = new Set(
      (entries ?? [])
        .map((row) => row.invoiceLetterValue)
        .filter((letter) => letter.trim().length > 0),
    );
    return ['A', 'B', 'C']
      .filter((letter) => letters.has(letter))
      .map((letter) => ({ value: letter, label: `Factura ${letter}` }));
  }, [entries]);

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
        excelExport={{
          fileName: (rows) =>
            getDateRangeExcelFileName(rows.map((row) => row.enteredAt)),
          onError: (error) =>
            showToast({ message: translateApiError(error), kind: 'error' }),
        }}
        data={entries ?? []}
        columns={columns}
        isLoading={entries === undefined}
        emptyMessage="No hay movimientos registrados todavía."
        searchPlaceholder="Buscar por ticket, patente, vehículo o notas…"
        searchableKeys={SEARCHABLE_KEYS}
        filterableColumns={filterableColumns}
        filterOptionsByColumn={{
          amountPaid: paymentMethodFilterOptions,
          cashSessionId: cashSessionFilterOptions,
          invoiceState: invoiceStateFilterOptions,
          invoiceLetterValue: invoiceLetterFilterOptions,
        }}
        initialColumnVisibility={INITIAL_COLUMN_VISIBILITY}
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
      {photoDetection ? (
        <DetectionImageDialog
          detection={photoDetection}
          onClose={() => setPhotoDetection(null)}
        />
      ) : null}
    </>
  );
}
