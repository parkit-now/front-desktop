import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, LogOut, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../data-table';
import { VehicleCell } from '../data-table/components/VehicleCell';
import { PlateCell } from '../data-table/components/PlateCell';
import { StayDateCell } from '../data-table/components/StayDateCell';
import { dateTimeSorting } from '../data-table/utils';
import {
  localDb,
  type LocalCashSession,
  type LocalEntry,
  type LocalLprDetectionEvent,
  type LocalPaymentTransaction,
} from '../../lib/db/localDb';
import { EntryEditDialog } from './EntryEditDialog';
import { DetectionImageDialog } from '../camera/DetectionImageDialog';
import { hasDetectionImage } from '../camera/detectionImage';
import { useNetwork } from '../../lib/network/NetworkContext';
import { EntryDeleteAction } from './EntryDeleteAction';
import { EntryDeleteDialog } from './EntryDeleteDialog';
import { entryDeletionBlockers } from './entryDeletion';
import { InlineEntryField } from './InlineEntryField';

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
  enteredAtLocalDate: string;
  enteredMs: number;
  lprDetection: LocalLprDetectionEvent | null;
  entry: EditableActiveEntry;
};

function toRow(
  e: LocalEntry,
  paymentLines: LocalPaymentTransaction[],
  lprDetection: LocalLprDetectionEvent | null,
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
    enteredAtLocalDate: e.enteredAt.slice(0, 10),
    enteredMs: new Date(e.enteredAt).getTime(),
    lprDetection,
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
  const [deletingEntry, setDeletingEntry] =
    useState<EditableActiveEntry | null>(null);
  const { isOnline } = useNetwork();
  const [photoDetection, setPhotoDetection] =
    useState<LocalLprDetectionEvent | null>(null);
  const activeEntries = useLiveQuery(
    () =>
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter((e) => !e.leftAt && !e.deletedAt)
        .toArray(),
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
  const pendingOps = useLiveQuery(
    () => localDb.pendingOps.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  const allSessions = useLiveQuery(
    () => localDb.cashSessions.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  const allLprDetections = useLiveQuery(
    () =>
      localDb.lprDetectionEvents.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !editingEntry && !deletingEntry) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editingEntry, deletingEntry, onClose]);

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

    const detectionByEntryId = new Map<string, LocalLprDetectionEvent>();
    (allLprDetections ?? [])
      .filter((event) => event.entryId && hasDetectionImage(event))
      .sort(
        (a, b) =>
          new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
      )
      .forEach((event) => {
        if (event.entryId && !detectionByEntryId.has(event.entryId)) {
          detectionByEntryId.set(event.entryId, event);
        }
      });

    return (activeEntries ?? [])
      .map((entry) =>
        toRow(
          entry,
          paymentsByEntryId.get(entry.id) ?? [],
          detectionByEntryId.get(entry.id) ?? null,
        ),
      )
      .sort((a, b) => b.enteredMs - a.enteredMs);
  }, [activeEntries, allLprDetections, allPaymentTransactions]);

  const editingCashSession: LocalCashSession | undefined =
    editingEntry?.cashSessionId
      ? allSessions?.find(
          (session) => session.id === editingEntry.cashSessionId,
        )
      : undefined;

  const columns = useMemo<ColumnDef<ActiveRow, unknown>[]>(
    () => [
      {
        id: 'photo',
        header: '',
        size: 42,
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const detection = row.original.lprDetection;
          const disabled = !hasDetectionImage(detection);
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
                if (detection && hasDetectionImage(detection))
                  setPhotoDetection(detection);
              }}
            >
              <Eye size={16} aria-hidden="true" />
            </button>
          );
        },
      },
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
        size: 120,
        cell: ({ row }) => <PlateCell plate={row.original.plate} />,
      },
      {
        id: 'vehicle',
        accessorFn: (row) =>
          [row.vehicleBrand, row.vehicleModel, row.color]
            .filter((value) => value && value !== '—')
            .join(' '),
        header: 'Vehículo',
        size: 160,
        cell: ({ row }) => (
          <VehicleCell
            brand={row.original.vehicleBrand}
            model={row.original.vehicleModel}
            color={row.original.color}
          />
        ),
      },
      {
        accessorKey: 'vehicleBrand',
        header: 'Marca',
        enableHiding: false,
        meta: { filterOnly: true, displayColumnId: 'vehicle' },
      },
      {
        accessorKey: 'vehicleModel',
        header: 'Modelo',
        enableHiding: false,
        meta: { filterOnly: true, displayColumnId: 'vehicle' },
      },
      {
        id: 'enteredAt',
        header: 'Ingreso',
        accessorKey: 'enteredAtLocalDate',
        size: 180,
        filterFn: 'dateRange',
        sortingFn: dateTimeSorting((row) => row.enteredAt),
        cell: ({ row }) => <StayDateCell enteredAt={row.original.enteredAt} />,
      },
      {
        accessorKey: 'rate',
        header: 'Tarifa',
        size: 140,
      },
      {
        accessorKey: 'color',
        header: 'Color',
        enableHiding: false,
        meta: { filterOnly: true, displayColumnId: 'vehicle' },
      },
      {
        accessorKey: 'cochera',
        header: 'Cochera',
        size: 100,
        cell: ({ row }) => (
          <InlineEntryField
            entry={row.original.entry}
            field="cochera"
            tenantId={tenantId}
            accessToken={accessToken}
            isOnline={isOnline}
            disabledReason={
              allSessions?.find(
                (session) => session.id === row.original.entry.cashSessionId,
              )?.closedAt
                ? 'La caja está cerrada; no se pueden editar sus ingresos.'
                : undefined
            }
          />
        ),
      },
      {
        accessorKey: 'notes',
        header: 'Notas',
        size: 190,
        cell: ({ row }) => (
          <InlineEntryField
            entry={row.original.entry}
            field="notes"
            tenantId={tenantId}
            accessToken={accessToken}
            isOnline={isOnline}
            disabledReason={
              allSessions?.find(
                (session) => session.id === row.original.entry.cashSessionId,
              )?.closedAt && actorRole !== 'owner'
                ? 'La caja está cerrada; no se pueden editar sus ingresos.'
                : undefined
            }
          />
        ),
      },
      {
        id: 'actions',
        header: 'Acción',
        enableHiding: false,
        enableSorting: false,
        size: actorRole === 'owner' ? 190 : 150,
        meta: { excludeFromExport: true },
        cell: ({ row }) => (
          <div className="entry-row-actions">
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
            {actorRole === 'owner' && (
              <EntryDeleteAction
                plate={row.original.plate}
                blockers={
                  allInvoices === undefined ||
                  allSessions === undefined ||
                  pendingOps === undefined
                    ? ['Cargando el estado del ingreso.']
                    : entryDeletionBlockers({
                        entry: row.original.entry,
                        invoice: allInvoices.find(
                          (item) => item.entryId === row.original.id,
                        ),
                        payments: row.original.entry.paymentLines,
                        sessions: allSessions,
                        pendingOps,
                        isOnline,
                      })
                }
                onClick={() => setDeletingEntry(row.original.entry)}
              />
            )}
          </div>
        ),
      },
    ],
    [
      onExit,
      actorRole,
      allInvoices,
      allSessions,
      pendingOps,
      isOnline,
      tenantId,
      accessToken,
    ],
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
              allInvoices === undefined ||
              pendingOps === undefined ||
              allSessions === undefined ||
              allLprDetections === undefined
            }
            emptyMessage="No hay vehículos estacionados en este momento."
            searchPlaceholder="Buscar por ticket, patente, vehículo, color o notas…"
            searchableKeys={[
              'ticketNumber',
              'plate',
              'vehicleBrand',
              'vehicleModel',
              'color',
              'cochera',
              'notes',
            ]}
            filterableColumns={[
              'enteredAt',
              'vehicleBrand',
              'vehicleModel',
              'rate',
              'color',
              'cochera',
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
      {photoDetection ? (
        <DetectionImageDialog
          key={photoDetection.id}
          detection={photoDetection}
          tenantId={tenantId}
          accessToken={accessToken}
          onClose={() => setPhotoDetection(null)}
        />
      ) : null}
      {deletingEntry && (
        <EntryDeleteDialog
          tenantId={tenantId}
          accessToken={accessToken}
          entry={deletingEntry}
          paidTotal={
            deletingEntry.paymentLines.length > 0
              ? deletingEntry.paymentLines.reduce(
                  (sum, line) => sum + line.amount,
                  0,
                )
              : deletingEntry.amountPaid != null
                ? Number(deletingEntry.amountPaid)
                : null
          }
          onClose={() => setDeletingEntry(null)}
        />
      )}
    </div>
  );
}
