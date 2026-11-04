import {
  createTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingFn,
} from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';
import { INVOICE_STATE_ORDER } from '../entries/invoiceUtils';
import {
  caseInsensitiveSort,
  dateTimeSorting,
  enumOrderSorting,
  textSorting,
} from './utils';

/**
 * Orden de cada columna del historial, en las dos direcciones.
 *
 * Los datos están elegidos para que el orden correcto DIFIERA del
 * lexicográfico: con tickets de uno y tres dígitos, montos de distinta
 * longitud y estados de factura cuya clave interna es inglesa. Si el
 * comparador vuelve a normalizar todo a texto, estos casos fallan.
 *
 * Gemelo de `front-web/src/features/data-table/historySorting.test.ts`, con
 * los ids de columna de este repo: acá son `enteredAt`, `leftAt` y
 * `amountPaid`, mientras que en web son `enteredAtLocalDate`,
 * `leftAtLocalDate` y `paymentMethodValues`.
 *
 * Igual que `dateTimeSorting.test.ts`, el test redeclara los column defs en
 * vez de importarlos de `EntryHistoryPanel` (traerlos arrastraría React y
 * Dexie). No detecta, entonces, que alguien renombre un id en el panel.
 */

type Row = {
  id: string;
  ticketNumber?: number;
  plate: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  enteredAt: string;
  leftAt?: string | null;
  amountPaid?: string | null;
  paymentLines: { amount: number }[];
  invoiceState: string;
  cashSessionOpenedAt?: string | null;
  rateSnapshotName?: string | null;
  notes?: string | null;
  cochera?: string | null;
  invoiceReceiver?: string | null;
};

const unusedFilter = () => {
  throw new Error('Unexpected custom filter');
};

const dateOnly = (value: string | null | undefined) =>
  value?.slice(0, 10) ?? '';

/** Las mismas definiciones que usa `EntryHistoryPanel`, en lo que hace al orden. */
const COLUMNS: Record<string, ColumnDef<Row, unknown>> = {
  ticketNumber: { id: 'ticketNumber', accessorKey: 'ticketNumber' },
  // La patente va por texto: es un código, no una cantidad.
  plate: { id: 'plate', accessorKey: 'plate', sortingFn: textSorting() },
  vehicle: {
    id: 'vehicle',
    accessorFn: (row) =>
      [row.vehicleBrand, row.vehicleModel].filter(Boolean).join(' '),
  },
  enteredAt: {
    id: 'enteredAt',
    accessorFn: (row) => dateOnly(row.enteredAt),
    sortingFn: dateTimeSorting((row: Row) => row.enteredAt),
  },
  leftAt: {
    id: 'leftAt',
    accessorFn: (row) => dateOnly(row.leftAt),
    sortingFn: dateTimeSorting((row: Row) => row.leftAt),
  },
  amountPaid: {
    id: 'amountPaid',
    accessorFn: (row) => {
      if (row.paymentLines.length > 0) {
        return row.paymentLines.reduce((total, line) => total + line.amount, 0);
      }
      return row.amountPaid != null ? parseFloat(row.amountPaid) : null;
    },
  },
  invoiceState: {
    id: 'invoiceState',
    accessorKey: 'invoiceState',
    sortingFn: enumOrderSorting<Row>(INVOICE_STATE_ORDER),
  },
  cashSessionId: {
    id: 'cashSessionId',
    accessorFn: (row) => dateOnly(row.cashSessionOpenedAt),
    sortingFn: dateTimeSorting((row: Row) => row.cashSessionOpenedAt),
  },
  rateSnapshotName: { id: 'rateSnapshotName', accessorKey: 'rateSnapshotName' },
  notes: { id: 'notes', accessorKey: 'notes' },
  cochera: { id: 'cochera', accessorKey: 'cochera' },
  invoiceReceiver: { id: 'invoiceReceiver', accessorKey: 'invoiceReceiver' },
};

function orderedIds(data: Row[], columnId: string, desc: boolean): string[] {
  const column = COLUMNS[columnId];
  const table = createTable<Row>({
    data,
    columns: [column],
    filterFns: {
      includesSome: unusedFilter as never,
      dateRange: unusedFilter as never,
      numberRange: unusedFilter as never,
    },
    defaultColumn: {
      sortingFn: caseInsensitiveSort as SortingFn<Row>,
    },
    state: {
      sorting: [{ id: columnId, desc }],
      pagination: { pageIndex: 0, pageSize: 50 },
      columnFilters: [],
    },
    onStateChange: () => {},
    renderFallbackValue: null,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
  return table.getRowModel().rows.map((row) => row.id);
}

/**
 * Cuatro estadías. En cada columna el orden esperado difiere del que daría
 * comparar como texto, salvo donde se aclara lo contrario.
 */
const ROWS: Row[] = [
  {
    id: 'uno',
    ticketNumber: 1,
    plate: 'AD312MB',
    vehicleBrand: 'Volkswagen',
    vehicleModel: 'Bora',
    enteredAt: '2026-10-06T09:53:00-03:00',
    leftAt: '2026-10-06T17:52:00-03:00',
    amountPaid: '300',
    paymentLines: [],
    invoiceState: 'na',
    cashSessionOpenedAt: '2026-10-06T07:08:00-03:00',
    rateSnapshotName: 'Álamo',
    notes: 'zeta',
    cochera: 'B2',
    invoiceReceiver: 'Zulma',
  },
  {
    id: 'dos',
    ticketNumber: 2,
    plate: 'AA947KB',
    vehicleBrand: 'Honda',
    enteredAt: '2026-10-07T08:00:00-03:00',
    leftAt: null,
    amountPaid: '9500.5',
    paymentLines: [],
    invoiceState: 'issued',
    cashSessionOpenedAt: '2026-10-07T07:15:00-03:00',
    rateSnapshotName: 'estadia',
    notes: null,
    cochera: null,
    invoiceReceiver: null,
  },
  {
    id: 'diez',
    ticketNumber: 10,
    plate: 'A301WGK',
    vehicleBrand: 'Fiat',
    vehicleModel: 'Cronos',
    enteredAt: '2026-10-08T10:00:00-03:00',
    leftAt: '2026-10-08T12:00:00-03:00',
    amountPaid: null,
    paymentLines: [{ amount: 500 }, { amount: 300 }],
    invoiceState: 'pending',
    cashSessionOpenedAt: '2026-10-08T07:20:00-03:00',
    rateSnapshotName: 'Ñandu',
    notes: 'alfa',
    cochera: 'A10',
    invoiceReceiver: 'ana',
  },
  {
    id: 'cien',
    ticketNumber: 100,
    plate: 'JNF430',
    vehicleBrand: 'Chevrolet',
    vehicleModel: 'Onix',
    enteredAt: '2026-10-09T11:00:00-03:00',
    leftAt: '2026-10-09T20:00:00-03:00',
    amountPaid: '20000',
    paymentLines: [],
    invoiceState: 'error',
    cashSessionOpenedAt: '2026-10-09T07:13:00-03:00',
    rateSnapshotName: 'bora',
    notes: 'mu',
    cochera: 'C1',
    invoiceReceiver: 'Mario',
  },
];

/** Orden ascendente esperado por columna. El descendente es su inverso. */
const EXPECTED_ASC: Record<string, string[]> = {
  // Lexicográfico daría 1, 10, 100, 2.
  ticketNumber: ['uno', 'dos', 'diez', 'cien'],
  plate: ['diez', 'dos', 'uno', 'cien'],
  vehicle: ['cien', 'diez', 'dos', 'uno'],
  enteredAt: ['uno', 'dos', 'diez', 'cien'],
  // El egreso vacío (auto adentro) queda primero en ascendente.
  leftAt: ['dos', 'uno', 'diez', 'cien'],
  // 300 < 800 (suma de líneas) < 9500,5 < 20000. Como texto: 20000 < 300.
  amountPaid: ['uno', 'diez', 'dos', 'cien'],
  // Por flujo del estado, no alfabético: pending, none, error, issued, na.
  invoiceState: ['diez', 'cien', 'dos', 'uno'],
  cashSessionId: ['uno', 'dos', 'diez', 'cien'],
  // localeCompare 'es' ignora acentos y mayúsculas: Álamo, bora, estadia, Ñandu.
  rateSnapshotName: ['uno', 'cien', 'dos', 'diez'],
  // Los vacíos primero, el resto alfabético: alfa, mu, zeta.
  notes: ['dos', 'diez', 'cien', 'uno'],
  cochera: ['dos', 'diez', 'uno', 'cien'],
  invoiceReceiver: ['dos', 'diez', 'cien', 'uno'],
};

describe('orden de las columnas del historial', () => {
  describe.each(Object.keys(EXPECTED_ASC))('%s', (columnId) => {
    it('ascendente', () => {
      expect(orderedIds(ROWS, columnId, false)).toEqual(EXPECTED_ASC[columnId]);
    });

    it('descendente invierte el ascendente', () => {
      expect(orderedIds(ROWS, columnId, true)).toEqual(
        [...EXPECTED_ASC[columnId]].reverse(),
      );
    });
  });
});

describe('columna Factura', () => {
  it('recorre los siete estados en el orden del flujo, no alfabético', () => {
    const rows: Row[] = [...INVOICE_STATE_ORDER]
      // Al revés, para que el orden de entrada no explique el resultado.
      .reverse()
      .map((state, index) => ({
        id: state,
        plate: `P${index}`,
        enteredAt: '2026-10-06T09:00:00-03:00',
        paymentLines: [],
        invoiceState: state,
      }));

    expect(orderedIds(rows, 'invoiceState', false)).toEqual([
      ...INVOICE_STATE_ORDER,
    ]);
  });
});
