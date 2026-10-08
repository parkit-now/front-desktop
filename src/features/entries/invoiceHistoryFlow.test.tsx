// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalEntry, LocalInvoice } from '../../lib/db/localDb';
import { localDb } from '../../lib/db/localDb';
import { ExitModal } from './ExitModal';
import { EntryHistoryPanel } from './EntryHistoryPanel';

const mock = vi.hoisted(() => ({
  tables: new Map<string, Map<string, Record<string, unknown>>>(),
  listeners: new Set<() => void>(),
  close: vi.fn(),
  correct: vi.fn(),
  issue: vi.fn(),
  preview: vi.fn(),
  pull: vi.fn(),
  toast: vi.fn(),
  online: true,
}));
vi.mock('../../lib/db/localDb', () => {
  type Row = Record<string, unknown>;
  const notify = () => mock.listeners.forEach((listener) => listener());
  function table(name: string) {
    const rows = new Map<string, Row>();
    mock.tables.set(name, rows);
    function query(matches: () => Row[]) {
      return {
        toArray: () => Promise.resolve(matches()),
        first: () => Promise.resolve(matches()[0]),
        filter: (predicate: (row: Row) => boolean) =>
          query(() => matches().filter(predicate)),
        delete: () => {
          matches().forEach((row) => rows.delete(String(row.id)));
          notify();
          return Promise.resolve();
        },
      };
    }
    return {
      get: (id: string) => Promise.resolve(rows.get(id)),
      where: (field: string) => ({
        equals: (value: unknown) =>
          query(() => [...rows.values()].filter((row) => row[field] === value)),
      }),
      update: (id: string, patch: Row) => {
        rows.set(id, { ...rows.get(id), ...patch });
        notify();
        return Promise.resolve(1);
      },
      bulkPut: (incoming: Row[]) => {
        incoming.forEach((row) => rows.set(String(row.id), row));
        notify();
        return Promise.resolve();
      },
    };
  }
  return {
    localDb: {
      entries: table('entries'),
      invoices: table('invoices'),
      cashSessions: table('cashSessions'),
      paymentMethods: table('paymentMethods'),
      paymentTransactions: table('paymentTransactions'),
      pendingOps: table('pendingOps'),
      rates: table('rates'),
      vehicleTypes: table('vehicleTypes'),
      lprDetectionEvents: table('lprDetectionEvents'),
      reservations: table('reservations'),
      transaction: (_mode: string, ...args: unknown[]) =>
        (args.at(-1) as () => Promise<void>)(),
    },
  };
});
vi.mock('dexie-react-hooks', async () => {
  const { useEffect, useRef, useState } = await import('react');
  return {
    useLiveQuery: (query: () => unknown, deps: unknown[] = []) => {
      const [data, setData] = useState<unknown>();
      const queryRef = useRef(query);
      queryRef.current = query;
      const key = JSON.stringify(deps);
      useEffect(() => {
        let generation = 0;
        let alive = true;
        const read = () => {
          const current = ++generation;
          void Promise.resolve(queryRef.current()).then((value) => {
            if (alive && current === generation) setData(value);
          });
        };
        mock.listeners.add(read);
        read();
        return () => {
          alive = false;
          mock.listeners.delete(read);
        };
      }, [key]);
      return data;
    },
  };
});
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mock.online }),
}));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: mock.toast }),
}));
vi.mock('../../lib/api/entries', () => ({
  closeEntry: mock.close,
  correctEntry: mock.correct,
}));
vi.mock('../../lib/api/arca', () => ({
  issueInvoice: mock.issue,
  getInvoicePreview: mock.preview,
}));
vi.mock('../../lib/sync/SyncService', () => ({
  syncService: { pullInvoices: mock.pull },
}));
vi.mock('./useArcaEmitter', () => ({
  useArcaEmitter: () => ({ condicionIva: 'monotributo', certExpired: false }),
}));
vi.mock('./useInvoiceReceiver', () => ({
  useInvoiceReceiver: () => ({
    choice: 'final',
    ready: true,
    lookup: { status: 'idle' },
    markTouched: vi.fn(),
  }),
}));
vi.mock('./InvoiceReceiverChooser', () => ({
  InvoiceReceiverChooser: () => <span>Consumidor final</span>,
}));
vi.mock('./useMercadoPagoIntent', () => ({
  useMercadoPagoIntent: () => ({ intent: null, isStarting: false }),
}));

const enteredAt = '2026-10-07T10:00:00Z';
const leftAt = '2026-10-07T11:00:00Z';
const entry: LocalEntry = {
  id: 'entry',
  tenantId: 'tenant',
  plate: 'IAG574',
  cashSessionId: 'cash',
  enteredAt,
  rateSnapshotName: 'AUTO',
  rateSnapshotHourPriceArs: '10',
  version: 1,
  syncSeq: 1,
  updatedAt: enteredAt,
};
const invoice: LocalInvoice = {
  id: 'invoice',
  tenantId: 'tenant',
  entryId: 'entry',
  status: 'issued',
  impTotal: 10,
  cbteTipo: 11,
  ptoVta: 7,
  cbteNro: 9,
  cae: '123456789',
  receptorDocTipo: 99,
  receptorDocNro: '0',
  receptorNombre: 'Consumidor Final',
  version: 2,
  syncSeq: 2,
  updatedAt: leftAt,
};
let root: Root;
let container: HTMLDivElement;
async function click(text: string, host: Element = container) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  )!;
  expect(button).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(() => Promise.resolve(button.click()));
}
function historyRow() {
  return container.querySelector('tbody tr')!;
}
async function render(withExit = false) {
  await act(() =>
    Promise.resolve(
      root.render(
        <>
          <EntryHistoryPanel
            tenantId="tenant"
            userId="user"
            accessToken="token"
            actorRole="owner"
          />
          {withExit ? (
            <ExitModal
              entry={entry}
              tenantId="tenant"
              accessToken="token"
              onClose={vi.fn()}
            />
          ) : null}
        </>,
      ),
    ),
  );
}
async function emit(host: Element) {
  await click('Emitir factura', host);
  await click('Emitir Factura C', host);
  const confirmation = container.querySelector('.confirm-dialog')!;
  expect(confirmation).toBeTruthy();
  await click('Emitir Factura C', confirmation);
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  vi.setSystemTime(new Date(leftAt));
  localStorage.clear();
  mock.tables.forEach((rows) => rows.clear());
  mock.online = true;
  mock.tables.get('entries')!.set(entry.id, { ...entry });
  mock.tables
    .get('cashSessions')!
    .set('cash', { id: 'cash', tenantId: 'tenant', openedAt: enteredAt });
  mock.tables.get('paymentMethods')!.set('method', {
    id: 'method',
    tenantId: 'tenant',
    name: 'Transferencia',
    type: 'transfer',
    enabled: true,
    isDefault: true,
    invoiceMode: 'auto',
  });
  mock.preview.mockResolvedValue({ amount: 10 });
  mock.issue.mockResolvedValue(invoice);
  mock.pull.mockImplementation(() => localDb.invoices.bulkPut([invoice]));
  mock.close.mockResolvedValue({
    ...entry,
    leftAt,
    amountPaid: 10,
    version: 2,
    syncSeq: 2,
    updatedAt: leftAt,
    invoice,
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
  localStorage.clear();
  vi.useRealTimers();
});

describe('historial reactivo al facturar desde cualquier panel', () => {
  it('el cobro automatico actualiza la fila antes de cerrar el panel operativo', async () => {
    await render(true);
    expect(historyRow().textContent).not.toContain('Facturada');
    await click('Confirmar cobro', container.querySelector('.exit-modal')!);
    expect(mock.close).toHaveBeenCalledOnce();
    expect(mock.pull).toHaveBeenCalledWith({
      tenantId: 'tenant',
      bearer: 'token',
    });
    expect(historyRow().textContent).toContain('Facturada');
    expect(historyRow().textContent).toContain('0007-00000009');
    expect(container.querySelector('.exit-receipt')).toBeTruthy();
  });
  it('la emision posterior al cobro actualiza la misma tabla sin volver a montarla', async () => {
    mock.tables.get('paymentMethods')!.get('method')!.invoiceMode = 'manual';
    mock.close.mockResolvedValueOnce({
      ...entry,
      leftAt,
      amountPaid: 10,
      version: 2,
      syncSeq: 2,
      updatedAt: leftAt,
      invoice: { ...invoice, status: 'pending' },
    });
    mock.pull.mockImplementationOnce(() =>
      localDb.invoices.bulkPut([{ ...invoice, status: 'pending' }]),
    );
    await render(true);
    const row = historyRow();
    await click('Confirmar cobro', container.querySelector('.exit-modal')!);
    expect(historyRow().textContent).toContain('Pendiente');
    await emit(container.querySelector('.exit-modal')!);
    expect(historyRow()).toBe(row);
    expect(historyRow().textContent).toContain('Facturada');
    expect(mock.issue).toHaveBeenCalledOnce();
  });
  it('emitir desde el detalle refresca la fila y los datos del comprobante inmediatamente', async () => {
    mock.tables
      .get('entries')!
      .set(entry.id, { ...entry, leftAt, amountPaid: '10' });
    await render();
    const row = historyRow();
    expect(row.textContent).toContain('Sin factura');
    await act(() => Promise.resolve((row as HTMLTableRowElement).click()));
    await emit(container.querySelector('.entry-invoice-section')!);
    expect(historyRow()).toBe(row);
    expect(row.textContent).toContain('Facturada');
    expect(
      container.querySelector('.entry-invoice-section')!.textContent,
    ).toContain('123456789');
  });
  it('un fallo del refresco no revierte el cobro ni oculta su resultado fiscal', async () => {
    mock.pull.mockRejectedValueOnce(new Error('offline after charge'));
    await render(true);
    await click('Confirmar cobro', container.querySelector('.exit-modal')!);
    expect(mock.close).toHaveBeenCalledOnce();
    expect(mock.tables.get('entries')!.get(entry.id)?.leftAt).toBe(leftAt);
    expect(container.querySelector('.exit-receipt')!.textContent).toContain(
      'Factura C',
    );
    expect(mock.toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'info' }),
    );
  });
  it('corregir el cobro actualiza la fila y el importe de la factura pendiente', async () => {
    mock.tables.get('entries')!.set(entry.id, {
      ...entry,
      leftAt,
      amountPaid: '100',
    });
    mock.tables.get('invoices')!.set(invoice.id, {
      ...invoice,
      status: 'pending',
      impTotal: 100,
    });
    mock.correct.mockResolvedValue({
      ...entry,
      leftAt,
      amountPaid: 10,
      version: 2,
      syncSeq: 2,
      updatedAt: leftAt,
    });
    mock.pull.mockImplementationOnce(() =>
      localDb.invoices.bulkPut([
        { ...invoice, status: 'pending', impTotal: 10 },
      ]),
    );
    await render();
    const row = historyRow();
    await act(() => Promise.resolve((row as HTMLTableRowElement).click()));
    const amount = container.querySelector<HTMLInputElement>(
      '.entry-edit-payment-row input',
    )!;
    expect(amount.value).toBe('100.00');
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!.call(amount, '10.00');
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    await click('Guardar cambios');
    expect(mock.correct).toHaveBeenCalledOnce();
    expect(mock.pull).toHaveBeenCalledWith({
      tenantId: 'tenant',
      bearer: 'token',
    });
    expect(historyRow()).toBe(row);
    expect(mock.tables.get('entries')!.get(entry.id)?.amountPaid).toBe('10');
    expect(mock.tables.get('invoices')!.get(invoice.id)?.impTotal).toBe(10);
  });
});
