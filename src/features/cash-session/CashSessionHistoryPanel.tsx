import type { ColumnDef, SortingState } from '@tanstack/react-table';
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo, useState } from 'react';
import { localDb, type LocalCashSession } from '../../lib/db/localDb';
import { formatArs, formatArgentinaDateTime } from '../../lib/format/argentina';
import { DataTable } from '../data-table';
import { CashSessionDetailDialog } from './CashSessionDetailDialog';
import {
  computeSummariesBySession,
  type SessionSummary,
} from './cashSessionUtils';

interface Props {
  tenantId: string;
  accessToken: string;
  onSelectSession?: (session: LocalCashSession) => void;
}

const FILTERABLE_COLUMNS = ['openedAt', 'closedAt'];

const INITIAL_SORTING: SortingState = [{ id: 'openedAt', desc: true }];

const EMPTY_VEHICLE_COUNTS = new Map<string, number>();

const COLUMNS_HEAD: ColumnDef<LocalCashSession, unknown>[] = [
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
];

const COLUMNS_TAIL: ColumnDef<LocalCashSession, unknown>[] = [
  {
    accessorKey: 'openingCash',
    header: 'Fondo inicial',
    size: 130,
    sortingFn: 'basic',
    cell: ({ row }) => formatArs(row.original.openingCash),
  },
  {
    accessorKey: 'leavingCash',
    header: 'Fondo siguiente',
    size: 130,
    sortingFn: 'basic',
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

function buildDataColumns(
  summaries: Map<string, SessionSummary>,
  vehicleCounts: Map<string, number>,
): ColumnDef<LocalCashSession, unknown>[] {
  return [
    {
      id: 'vehicleCount',
      header: 'Vehículos',
      size: 110,
      sortingFn: 'basic',
      accessorFn: (row) => vehicleCounts.get(row.id) ?? 0,
      cell: ({ row }) => vehicleCounts.get(row.original.id) ?? 0,
    },
    {
      id: 'totalCollected',
      header: 'Total recaudado',
      size: 150,
      sortingFn: 'basic',
      accessorFn: (row) => summaries.get(row.id)?.grandTotal ?? 0,
      cell: ({ row }) => (
        <strong>
          {formatArs(summaries.get(row.original.id)?.grandTotal ?? 0)}
        </strong>
      ),
    },
    {
      id: 'cashInBox',
      header: 'Efectivo en caja',
      size: 150,
      sortingFn: 'basic',
      accessorFn: (row) => summaries.get(row.id)?.cashTotal ?? row.openingCash,
      cell: ({ row }) =>
        formatArs(
          summaries.get(row.original.id)?.cashTotal ?? row.original.openingCash,
        ),
    },
  ];
}

export function CashSessionHistoryPanel({
  tenantId,
  accessToken,
  onSelectSession,
}: Props) {
  const [detailSessionId, setDetailSessionId] = useState<string | null>(null);

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

  const transactions = useLiveQuery(
    () =>
      localDb.paymentTransactions.where('tenantId').equals(tenantId).toArray(),
    [tenantId],
  );

  // Counting through the cashSessionId index keeps this off the full entry rows.
  const vehicleCounts = useLiveQuery(async () => {
    const keys = await localDb.entries.orderBy('cashSessionId').keys();
    const counts = new Map<string, number>();
    for (const key of keys) {
      if (typeof key !== 'string') continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, []);

  const summaries = useMemo(
    () => computeSummariesBySession(sessions ?? [], transactions ?? []),
    [sessions, transactions],
  );

  const openDetail = useCallback(
    (session: LocalCashSession) => setDetailSessionId(session.id),
    [],
  );

  const columns = useMemo(
    () => [
      ...COLUMNS_HEAD,
      ...buildDataColumns(summaries, vehicleCounts ?? EMPTY_VEHICLE_COUNTS),
      ...COLUMNS_TAIL,
    ],
    [summaries, vehicleCounts],
  );

  const detailSession = detailSessionId
    ? (sessions?.find((s) => s.id === detailSessionId) ?? null)
    : null;

  return (
    <div className="cash-session-history">
      <h3 className="section-subheading">Historial de cajas</h3>
      <p className="muted cash-session-history-hint">
        Tocá una caja para ver el detalle del turno.
      </p>
      <DataTable
        columns={columns}
        data={sessions ?? []}
        isLoading={
          sessions === undefined ||
          transactions === undefined ||
          vehicleCounts === undefined
        }
        emptyMessage="No hay cajas cerradas registradas."
        filterableColumns={FILTERABLE_COLUMNS}
        initialSorting={INITIAL_SORTING}
        onRowClick={openDetail}
      />

      {detailSession ? (
        <CashSessionDetailDialog
          session={detailSession}
          tenantId={tenantId}
          accessToken={accessToken}
          onClose={() => setDetailSessionId(null)}
          onViewMovements={
            onSelectSession
              ? (session) => {
                  setDetailSessionId(null);
                  onSelectSession(session);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
