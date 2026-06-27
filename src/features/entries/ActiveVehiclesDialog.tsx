import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { LogOut, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { DataTable } from '../data-table';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import { formatArgentinaDateTime } from '../../lib/format/argentina';
import { formatDuration } from './entryUtils';

interface Props {
  tenantId: string;
  userId: string;
  onExit: (entry: LocalEntry) => void;
  onClose: () => void;
}

type ActiveRow = {
  id: string;
  ticketNumber: number | null;
  plate: string;
  vehicleBrand: string;
  vehicleModel: string;
  vehicle: string;
  color: string;
  rate: string;
  cochera: string;
  notes: string;
  enteredAt: string;
  enteredMs: number;
  entry: LocalEntry;
};

function toRow(e: LocalEntry): ActiveRow {
  const vehicle = [e.vehicleBrand, e.vehicleModel].filter(Boolean).join(' ');
  return {
    id: e.id,
    ticketNumber: e.ticketNumber ?? null,
    plate: e.plate,
    vehicleBrand: e.vehicleBrand ?? '',
    vehicleModel: e.vehicleModel ?? '',
    vehicle: vehicle || '—',
    color: e.color ?? '—',
    rate: e.rateSnapshotName ?? '—',
    cochera: e.cochera ?? '',
    notes: e.notes ?? '',
    enteredAt: e.enteredAt,
    enteredMs: new Date(e.enteredAt).getTime(),
    entry: e,
  };
}

export function ActiveVehiclesDialog({
  tenantId,
  userId,
  onExit,
  onClose,
}: Props) {
  const activeEntries = useLiveQuery(
    () =>
      localDb.entries
        .where('tenantId')
        .equals(tenantId)
        .filter((e) => !e.leftAt)
        .toArray(),
    [tenantId],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const rows = useMemo<ActiveRow[]>(
    () =>
      (activeEntries ?? [])
        .map(toRow)
        .sort((a, b) => b.enteredMs - a.enteredMs),
    [activeEntries],
  );

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
        accessorKey: 'vehicle',
        header: 'Vehículo',
        size: 180,
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
            onClick={() => onExit(row.original.entry)}
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
            isLoading={activeEntries === undefined}
            emptyMessage="No hay vehículos estacionados en este momento."
            searchPlaceholder="Buscar por patente, vehículo o notas..."
            searchableKeys={[
              'plate',
              'vehicleBrand',
              'vehicleModel',
              'cochera',
              'notes',
            ]}
            filterableColumns={['color', 'rate']}
            getRowId={(r) => r.id}
            initialPageSize={8}
            templateScope={{ userId, tenantId, tableKey: 'active-vehicles' }}
          />
        </div>
      </section>
    </div>
  );
}
