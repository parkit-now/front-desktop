import type { ColumnDef } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { localDb, type LocalCashSession } from '../../lib/db/localDb';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
import { DataTable } from '../data-table';

interface Props {
  tenantId: string;
  onSelectSession?: (session: LocalCashSession) => void;
}

const FILTERABLE_COLUMNS = ['openedAt', 'closedAt'];

const COLUMNS: ColumnDef<LocalCashSession, unknown>[] = [
  {
    accessorKey: 'openedAt',
    header: 'Apertura',
    size: 160,
    filterFn: 'dateRange',
    cell: ({ row }) => formatArgentinaDateTime(row.original.openedAt),
  },
  {
    accessorKey: 'closedAt',
    header: 'Cierre',
    size: 160,
    filterFn: 'dateRange',
    cell: ({ row }) =>
      row.original.closedAt ? (
        formatArgentinaDateTime(row.original.closedAt)
      ) : (
        <span className="status-badge status-badge--active">Activa</span>
      ),
  },
  {
    accessorKey: 'openingCash',
    header: 'Fondo inicial',
    size: 130,
    cell: ({ row }) => formatArs(row.original.openingCash),
  },
  {
    accessorKey: 'leavingCash',
    header: 'Fondo siguiente',
    size: 130,
    cell: ({ row }) =>
      row.original.leavingCash != null ? (
        formatArs(row.original.leavingCash)
      ) : (
        <span className="muted">—</span>
      ),
  },
  {
    accessorKey: 'notes',
    header: 'Notas',
    size: 200,
    cell: ({ row }) =>
      row.original.notes ? (
        row.original.notes
      ) : (
        <span className="muted">—</span>
      ),
  },
];

export function CashSessionHistoryPanel({ tenantId, onSelectSession }: Props) {
  const sessions = useLiveQuery(
    () =>
      localDb.cashSessions
        .where('tenantId')
        .equals(tenantId)
        .filter((s) => !!s.closedAt)
        .toArray()
        .then((arr) =>
          arr.sort(
            (a, b) =>
              new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
          ),
        ),
    [tenantId],
  );

  const columns = useMemo(() => COLUMNS, []);

  return (
    <div className="cash-session-history">
      <h3 className="section-subheading">Historial de cajas</h3>
      {onSelectSession ? (
        <p className="muted cash-session-history-hint">
          Tocá una caja para ver sus movimientos en el historial.
        </p>
      ) : null}
      <DataTable
        columns={columns}
        data={sessions ?? []}
        isLoading={sessions === undefined}
        emptyMessage="No hay cajas cerradas registradas."
        filterableColumns={FILTERABLE_COLUMNS}
        onRowClick={onSelectSession}
      />
    </div>
  );
}
