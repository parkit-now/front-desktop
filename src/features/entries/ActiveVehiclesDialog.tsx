import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { LogOut, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../data-table';
import {
  localDb,
  type LocalCashSession,
  type LocalEntry,
  type LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { formatArgentinaDateTime } from '../../lib/format/argentina';
import { formatDuration } from './entryUtils';
import { EntryEditDialog } from './EntryEditDialog';

interface Props {
  tenantId: string;
  userId: string;
  accessToken: string;
  actorRole: 'admin' | 'owner' | 'operator' | null;
  parkingName?: string | null;
  parkingAddress?: string | null;
  parkingCuit?: string | null;
  onExit: (entry: LocalEntry) => void;
  onClose: () => void;
}

type EditableActiveEntry = LocalEntry & {
  paymentLines: LocalPaymentTransaction[];
};

type ActiveRow = {
  id: string;
  ticketNumber: number | null;
  plate: string;
  vehicleBrand: string;
  vehicleModel: string;
  color: string;
  rate: string;
  cochera: string;
  notes: string;
  enteredAt: string;
  enteredMs: number;
  entry: EditableActiveEntry;
};

function toRow(
  e: LocalEntry,
  paymentLines: LocalPaymentTransaction[],
): ActiveRow {
  return {
    id: e.id,
    ticketNumber: e.ticketNumber ?? null,
    plate: e.plate,
    vehicleBrand: e.vehicleBrand ?? '',
    vehicleModel: e.vehicleModel ?? '',
    color: e.color ?? '—',
    rate: e.rateSnapshotName ?? '—',
    cochera: e.cochera ?? '',
    notes: e.notes ?? '',
    enteredAt: e.enteredAt,
    enteredMs: new Date(e.enteredAt).getTime(),
    entry: { ...e, paymentLines },
  };
}

export function ActiveVehiclesDialog({
  tenantId,
  userId,
  accessToken,
  actorRole,
  parkingName = null,
  parkingAddress = null,
  parkingCuit = null,
  onExit,
  onClose,
}: Props) {
  const [editingEntry, setEditingEntry] = useState<EditableActiveEntry | null>(
    null,
  );
  const activeEntries = useLiveQuery(
    () =>
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter((e) => !e.leftAt)
        .toArray(),
    [tenantId],
  );

  const allPaymentTransactions = useLiveQuery(
    () =>
      localDb.paymentTransactions.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  const allSessions = useLiveQuery(
    () => localDb.cashSessions.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !editingEntry) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingEntry, onClose]);

  const rows = useMemo<ActiveRow[]>(() => {
    const paymentsByEntryId = new Map<string, LocalPaymentTransaction[]>();
    (allPaymentTransactions ?? [])
      .filter((tx) => !tx.deletedAt)
      .forEach((tx) => {
        const lines = paymentsByEntryId.get(tx.entryId);
        if (lines) {
          lines.push(tx);
        } else {
          paymentsByEntryId.set(tx.entryId, [tx]);
        }
      });

    return (activeEntries ?? [])
      .map((entry) => toRow(entry, paymentsByEntryId.get(entry.id) ?? []))
      .sort((a, b) => b.enteredMs - a.enteredMs);
  }, [activeEntries, allPaymentTransactions]);

  const editingCashSession: LocalCashSession | undefined =
    editingEntry?.cashSessionId
      ? allSessions?.find(
          (session) => session.id === editingEntry.cashSessionId,
        )
      : undefined;

  const columns = useMemo<ColumnDef<ActiveRow, unknown>[]>(
    () => [
      {
        id: 'ticket',
        header: '#',
        accessorFn: (r) => r.ticketNumber ?? 0,
        size: 64,
        cell: ({ row }) =>
          row.original.ticketNumber != null ? (
            <span className="vehicle-ticket-badge">
              #{row.original.ticketNumber}
            </span>
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'plate',
        header: 'Patente',
        size: 110,
        cell: ({ row }) => <strong>{row.original.plate}</strong>,
      },
      {
        accessorKey: 'vehicleBrand',
        header: 'Marca',
        size: 110,
        cell: ({ row }) => row.original.vehicleBrand || '—',
      },
      {
        accessorKey: 'vehicleModel',
        header: 'Modelo',
        size: 120,
        cell: ({ row }) => row.original.vehicleModel || '—',
      },
      {
        accessorKey: 'color',
        header: 'Color',
        size: 110,
      },
      {
        id: 'duration',
        header: 'Duración',
        accessorFn: (r) => r.enteredMs,
        size: 110,
        // Longer parked first when sorted descending (older enteredMs is smaller,
        // so invert by sorting on negative elapsed via the raw ms ascending).
        cell: ({ row }) => formatDuration(row.original.enteredAt),
      },
      {
        accessorKey: 'rate',
        header: 'Tarifa',
        size: 140,
      },
      {
        accessorKey: 'cochera',
        header: 'Cochera',
        size: 100,
        cell: ({ row }) => row.original.cochera || '—',
      },
      {
        accessorKey: 'notes',
        header: 'Notas',
        size: 200,
        cell: ({ row }) =>
          row.original.notes ? (
            <span className="dt-cell-notes" title={row.original.notes}>
              {row.original.notes}
            </span>
          ) : (
            '—'
          ),
      },
      {
        id: 'enteredAt',
        header: 'Ingreso',
        accessorFn: (r) => r.enteredMs,
        size: 160,
        cell: ({ row }) => formatArgentinaDateTime(row.original.enteredAt),
      },
      {
        id: 'actions',
        header: 'Acción',
        enableHiding: false,
        enableSorting: false,
        size: 150,
        cell: ({ row }) => (
          <button
            type="button"
            className="primary-button compact"
            onClick={(event) => {
              event.stopPropagation();
              onExit(row.original.entry);
            }}
          >
            <LogOut size={15} aria-hidden="true" />
            Egreso
          </button>
        ),
      },
    ],
    [onExit],
  );

  return (
    <div
      className="rate-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="rate-dialog active-vehicles-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="active-vehicles-title"
      >
        <header className="rate-dialog-header">
          <div>
            <p className="rate-dialog-kicker">Egresos</p>
            <h3 id="active-vehicles-title">Autos en base</h3>
            <p className="muted">
              Vehículos estacionados ahora. Buscá por patente o vehículo y
              registrá el egreso.
            </p>
          </div>
          <button
            type="button"
            className="rate-dialog-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="active-vehicles-dialog__table data-table-host">
          <DataTable
            data={rows}
            columns={columns}
            isLoading={
              activeEntries === undefined ||
              allPaymentTransactions === undefined ||
              allSessions === undefined
            }
            emptyMessage="No hay vehículos estacionados en este momento."
            searchPlaceholder="Buscar por patente, vehículo o notas…"
            searchableKeys={[
              'plate',
              'vehicleBrand',
              'vehicleModel',
              'cochera',
              'notes',
            ]}
            filterableColumns={[
              'vehicleBrand',
              'vehicleModel',
              'color',
              'rate',
            ]}
            getRowId={(r) => r.id}
            onRowClick={(row) => setEditingEntry(row.entry)}
            initialPageSize={8}
            templateScope={{ userId, tenantId, tableKey: 'active-vehicles' }}
          />
        </div>
      </section>
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
          onClose={() => setEditingEntry(null)}
        />
      ) : null}
    </div>
  );
}
