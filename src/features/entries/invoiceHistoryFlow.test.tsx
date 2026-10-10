// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalEntry, LocalInvoice } from '../../lib/db/localDb';
import type { CloseEntryDto } from '../../lib/api/entries';
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
  document: vi.fn(),
  qr: vi.fn(),
  savePdf: vi.fn(),
  reveal: vi.fn(),
  toast: vi.fn(),
  online: true,
  accounts: [] as Record<string, unknown>[],
  enqueue: vi.fn(),
  qrIntent: null as null | {
    id: string;
    tenantId: string;
    entryId: string;
    amount: number;
    status: 'approved';
  },
  emitterStatus: 'ready',
  receiverReady: true,
  receiverChoice: 'final',
  receiverCuit: undefined as string | undefined,
  paymentMethodsPromise: null as Promise<Record<string, unknown>[]> | null,
}));
vi.mock('../../lib/db/localDb', () => {
  type Row = Record<string, unknown>;
  const notify = () => mock.listeners.forEach((listener) => listener());
  function table(name: string) {
    const rows = new Map<string, Row>();
    mock.tables.set(name, rows);
    function query(matches: () => Row[]) {
      return {
        toArray: () =>
          name === 'paymentMethods' && mock.paymentMethodsPromise
            ? mock.paymentMethodsPromise
            : Promise.resolve(matches()),
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
      clients: table('clients'),
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
vi.mock('../../lib/sync/enqueue', () => ({ enqueuePendingOp: mock.enqueue }));
vi.mock('../../lib/api/arca', () => ({
  issueInvoice: mock.issue,
  getInvoicePreview: mock.preview,
  getInvoiceDocument: mock.document,
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mock.qr } }));
vi.mock('./invoiceDocument', () => ({
  renderInvoiceHtml: () => '<html>Factura</html>',
}));
vi.mock('./saveInvoicePdf', () => ({ saveInvoicePdf: mock.savePdf }));
vi.mock('../../lib/sync/SyncService', () => ({
  syncService: {
    pullInvoices: mock.pull,
    pullClients: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('./useArcaEmitter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useArcaEmitter')>()),
  useArcaEmitter: () => ({ condicionIva: 'monotributo', certExpired: false }),
  useArcaEmitterState: () => ({
    emitter: { condicionIva: 'monotributo', certExpired: false },
    status: mock.emitterStatus,
    accounts: mock.accounts,
  }),
}));
vi.mock('./useInvoiceReceiver', () => ({
  useInvoiceReceiver: () => ({
    choice: mock.receiverChoice,
    ready: mock.receiverReady,
    cuitToSend: mock.receiverCuit,
    lookup: { status: 'idle' },
    markTouched: vi.fn(),
  }),
}));
vi.mock('./InvoiceReceiverChooser', () => ({
  InvoiceReceiverChooser: () => <span>Consumidor final</span>,
}));
vi.mock('./useMercadoPagoIntent', () => ({
  useMercadoPagoIntent: () => ({
    intent: mock.qrIntent,
    view: mock.qrIntent
      ? {
          tone: 'ok',
          title: 'Pago acreditado',
          detail: 'Confirmá el egreso',
          canConfirm: true,
          canCancel: false,
          canRetry: false,
          showCountdown: false,
        }
      : null,
    secondsLeft: 0,
    isStarting: false,
    isCanceling: false,
  }),
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
  selectedPaymentIds: [],
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
let previousDesktop: PropertyDescriptor | undefined;
async function click(text: string, host: Element = container) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === text,
  )!;
  expect(button).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(() => Promise.resolve(button.click()));
}
async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}
function historyRow() {
  return container.querySelector('tbody tr')!;
}
async function render(withExit = false, exitEntry = entry) {
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
              actorRole="owner"
              entry={exitEntry}
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
  mock.accounts = [];
  mock.enqueue.mockResolvedValue(1);
  mock.qrIntent = null;
  mock.emitterStatus = 'ready';
  mock.receiverReady = true;
  mock.receiverChoice = 'final';
  mock.receiverCuit = undefined;
  mock.paymentMethodsPromise = null;
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
  mock.document.mockResolvedValue({ qrUrl: 'https://example.test/qr' });
  mock.qr.mockResolvedValue('data:image/png;base64,qr');
  mock.savePdf.mockResolvedValue('/tmp/factura.pdf');
  mock.reveal.mockResolvedValue({ ok: true });
  previousDesktop = Object.getOwnPropertyDescriptor(window, 'parkitDesktop');
  Object.defineProperty(window, 'parkitDesktop', {
    configurable: true,
    value: { showSavedFileInFolder: mock.reveal },
  });
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
  if (previousDesktop)
    Object.defineProperty(window, 'parkitDesktop', previousDesktop);
  else Reflect.deleteProperty(window, 'parkitDesktop');
  localStorage.clear();
  vi.useRealTimers();
});

describe('historial reactivo al facturar desde cualquier panel', () => {
  async function chooseSecondary() {
    await click('Primaria · Emisor principal');
    await act(() =>
      Promise.resolve(
        (
          [...document.querySelectorAll('[role="option"]')].find((item) =>
            item.textContent?.includes('Emisor secundario'),
          ) as HTMLElement
        ).dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        ),
      ),
    );
  }

  function configureAccounts() {
    mock.accounts = [
      {
        id: 'primary',
        role: 'primary',
        status: 'linked',
        condicionIva: 'responsable_inscripto',
        cuit: '20123456786',
        razonSocial: 'Emisor principal',
        ptoVta: 1,
      },
      {
        id: 'secondary',
        role: 'secondary',
        status: 'linked',
        condicionIva: 'monotributo',
        cuit: '20447275865',
        razonSocial: 'Emisor secundario',
        ptoVta: 2,
      },
    ];
  }

  it.each(['none', 'manual', 'manual_pending'])(
    'no pide cuenta de facturación al cobrar con modo %s',
    async (mode) => {
      configureAccounts();
      mock.tables.get('paymentMethods')!.get('method')!.invoiceMode = mode;

      await render(true);

      expect(
        container.querySelector('.exit-modal .entry-invoice-account'),
      ).toBeNull();
      expect(
        [...container.querySelectorAll<HTMLButtonElement>('button')].find(
          (button) => button.textContent?.trim() === 'Confirmar cobro',
        )?.disabled,
      ).toBe(false);
    },
  );

  it('en modo manual ofrece elegir la cuenta recién al abrir emitir factura', async () => {
    configureAccounts();
    mock.tables.get('paymentMethods')!.get('method')!.invoiceMode = 'manual';
    mock.close.mockResolvedValueOnce({
      ...entry,
      leftAt,
      amountPaid: 10,
      version: 2,
      syncSeq: 2,
      updatedAt: leftAt,
      invoice: { ...invoice, status: 'not_required' },
    });

    await render(true);
    await click('Confirmar cobro', container.querySelector('.exit-modal')!);
    expect(
      container.querySelector('.exit-modal .entry-invoice-account'),
    ).toBeNull();

    await click('Emitir factura', container.querySelector('.exit-modal')!);

    expect(
      container.querySelector('.exit-issue-panel .entry-invoice-account')
        ?.textContent,
    ).toContain('Emisor principal');
  });

  it('el dueño elige secundaria antes del cobro automático; un egreso nuevo vuelve a primaria', async () => {
    configureAccounts();
    await render(true);
    await chooseSecondary();
    await click('Confirmar cobro');
    expect(
      mock.close.mock.calls[0]?.[0] as { body: CloseEntryDto },
    ).toMatchObject({ body: { arcaAccountId: 'secondary' } });
    await act(() => Promise.resolve(root.render(null)));
    await render(true);
    expect(
      container.querySelector('.entry-invoice-account')?.textContent,
    ).toContain('Emisor principal');
  });

  it('el cobro sin conexión conserva secundaria en la operación encolada', async () => {
    configureAccounts();
    mock.online = false;
    await render(true);
    await chooseSecondary();
    await click('Confirmar cobro');
    expect(mock.close).not.toHaveBeenCalled();
    expect(
      mock.enqueue.mock.calls[0]?.[0] as { payload: { body: CloseEntryDto } },
    ).toMatchObject({ payload: { body: { arcaAccountId: 'secondary' } } });
  });
  it('muestra marca y modelo junto a los datos del egreso', async () => {
    await render(true, {
      ...entry,
      vehicleBrand: 'Ford',
      vehicleModel: 'Ranger',
      color: 'NARANJA',
      ticketNumber: 23,
    });

    const header = container.querySelector('.exit-modal .rate-dialog-header')!;
    expect(header.textContent).toContain('IAG574');
    expect(header.textContent).toContain('Ford Ranger');
    expect(header.textContent).toContain('NARANJA');
    expect(header.textContent).toContain('Ticket #23');
  });

  it('en un cobro dividido envía sólo el pago elegido para la factura automática', async () => {
    mock.tables.get('paymentMethods')!.get('method')!.name = 'Mercado Pago QR';
    mock.tables.get('paymentMethods')!.get('method')!.type = 'mercadopago_qr';
    mock.tables.get('paymentMethods')!.set('mp', {
      id: 'mp',
      tenantId: 'tenant',
      name: 'Mercado Pago',
      type: 'transfer',
      enabled: true,
      invoiceMode: 'auto',
    });
    mock.tables.get('paymentMethods')!.set('cash-method', {
      id: 'cash-method',
      tenantId: 'tenant',
      name: 'Efectivo',
      type: 'cash',
      enabled: true,
      invoiceMode: 'manual',
    });
    await render(true);
    const modal = container.querySelector('.exit-modal')!;
    await changeInput(
      modal.querySelector<HTMLInputElement>('#exit-amount')!,
      '5000',
    );
    act(() => {
      modal
        .querySelector<HTMLInputElement>('.exit-split-toggle input')!
        .click();
    });
    for (const [name, value] of [
      ['Mercado Pago QR', '2500'],
      ['Mercado Pago', '1500'],
      ['Efectivo', '1000'],
    ]) {
      await changeInput(
        modal.querySelector<HTMLInputElement>(
          `input[aria-label="Monto en ${name}"]`,
        )!,
        value,
      );
    }
    const rows = [
      ...modal.querySelectorAll<HTMLLabelElement>(
        '.invoice-payment-selector__row',
      ),
    ];
    for (const name of ['Mercado Pago', 'Efectivo']) {
      act(() => {
        rows
          .find(
            (row) =>
              row.textContent?.includes(name) &&
              !row.textContent?.includes('QR'),
          )!
          .querySelector<HTMLInputElement>('input')!
          .click();
      });
    }
    expect(
      modal.querySelector('.invoice-payment-selector__total')?.textContent,
    ).toContain('2.500');
    await click('Confirmar cobro', modal);
    const body = (mock.close.mock.calls[0][0] as { body: CloseEntryDto }).body;
    expect(body.payments).toHaveLength(3);
    expect(body.invoicePaymentIds).toEqual([
      body.payments?.find((line) => line.paymentMethodId === 'method')?.id,
    ]);
  });

  it('un QR recuperado espera configuracion y CUIT antes de facturar automaticamente', async () => {
    Object.assign(mock.tables.get('paymentMethods')!.get('method')!, {
      name: 'Mercado Pago QR',
      type: 'mercadopago_qr',
    });
    let resolveMethods!: (rows: Record<string, unknown>[]) => void;
    mock.paymentMethodsPromise = new Promise((resolve) => {
      resolveMethods = resolve;
    });
    mock.qrIntent = {
      id: 'intent',
      tenantId: 'tenant',
      entryId: 'entry',
      amount: 10,
      status: 'approved',
    };
    mock.emitterStatus = 'loading';
    mock.receiverReady = false;
    await render(true);
    const confirm = () =>
      container.querySelector<HTMLButtonElement>('.qr-panel .primary-button')!;
    expect(confirm().disabled).toBe(true);

    await act(async () => {
      resolveMethods([...mock.tables.get('paymentMethods')!.values()]);
      await Promise.resolve();
    });
    expect(confirm().disabled).toBe(true);

    mock.emitterStatus = 'ready';
    await render(true);
    expect(confirm().disabled).toBe(true);

    mock.receiverReady = true;
    mock.receiverChoice = 'cuit';
    mock.receiverCuit = '20427205208';
    await render(true);
    expect(confirm().disabled).toBe(false);
    await click('Confirmar egreso', container.querySelector('.qr-panel')!);
    expect(mock.close.mock.calls[0]?.[0]).toMatchObject({
      body: {
        invoiceReceiverCuit: '20427205208',
        payments: [{ paymentIntentId: 'intent' }],
      },
    });
  });

  it('un CUIT no facturable no cierra el QR como consumidor final en silencio', async () => {
    Object.assign(mock.tables.get('paymentMethods')!.get('method')!, {
      name: 'Mercado Pago QR',
      type: 'mercadopago_qr',
    });
    mock.qrIntent = {
      id: 'intent',
      tenantId: 'tenant',
      entryId: 'entry',
      amount: 10,
      status: 'approved',
    };
    mock.receiverChoice = 'cuit';
    await render(true);
    const confirm = () =>
      container.querySelector<HTMLButtonElement>('.qr-panel .primary-button')!;
    expect(confirm().disabled).toBe(true);
    expect(mock.close).not.toHaveBeenCalled();

    mock.receiverChoice = 'final';
    await render(true);
    expect(confirm().textContent).toBe('Confirmar como consumidor final');
    expect(confirm().disabled).toBe(false);
  });

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
  it('ofrece mostrar la carpeta solo despues de guardar el PDF del comprobante', async () => {
    await render(true);
    await click('Confirmar cobro', container.querySelector('.exit-modal')!);
    const receipt = container.querySelector('.exit-receipt')!;
    expect(
      receipt.querySelector('[aria-label="Mostrar PDF en carpeta"]'),
    ).toBeNull();
    await click('Descargar PDF', receipt);
    expect(mock.savePdf).toHaveBeenCalledWith(
      '00000009-0007_123456789_IAG574.pdf',
      '<html>Factura</html>',
    );
    const folder = receipt.querySelector<HTMLButtonElement>(
      '[aria-label="Mostrar PDF en carpeta"]',
    );
    expect(folder).not.toBeNull();
    await act(() => Promise.resolve(folder!.click()));
    expect(mock.reveal).toHaveBeenCalledWith('/tmp/factura.pdf');
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
      invoice: { ...invoice, status: 'not_required' },
    });
    mock.pull.mockImplementationOnce(() =>
      localDb.invoices.bulkPut([{ ...invoice, status: 'not_required' }]),
    );
    await render(true);
    const row = historyRow();
    await click('Confirmar cobro', container.querySelector('.exit-modal')!);
    expect(historyRow().textContent).toContain('No facturado');
    await emit(container.querySelector('.exit-modal')!);
    expect(historyRow()).toBe(row);
    expect(historyRow().textContent).toContain('Facturada');
    expect(mock.issue).toHaveBeenCalledOnce();
  });
  it('emitir desde el detalle refresca la fila y los datos del comprobante inmediatamente', async () => {
    mock.tables
      .get('entries')!
      .set(entry.id, { ...entry, leftAt, amountPaid: '10' });
    mock.tables.get('paymentTransactions')!.set('payment', {
      id: 'payment',
      tenantId: 'tenant',
      entryId: entry.id,
      paymentMethodId: 'method',
      paymentMethodName: 'Transferencia',
      amount: 10,
    });
    await render();
    const row = historyRow();
    expect(row.textContent).toContain('No facturado');
    await act(() => Promise.resolve((row as HTMLTableRowElement).click()));
    await emit(container.querySelector('.entry-invoice-section')!);
    expect(historyRow()).toBe(row);
    expect(row.textContent).toContain('Facturada');
    expect(
      container.querySelector('.entry-invoice-section')!.textContent,
    ).toContain('123456789');
  });
  it('desde Historial confirma el importe de un solo medio en un cobro dividido', async () => {
    mock.tables.get('entries')!.set(entry.id, {
      ...entry,
      leftAt,
      amountPaid: '5000',
    });
    mock.tables.get('paymentMethods')!.get('method')!.name = 'Mercado Pago QR';
    mock.tables.get('paymentMethods')!.set('mp', {
      id: 'mp',
      tenantId: 'tenant',
      name: 'Mercado Pago',
      type: 'transfer',
      enabled: true,
      invoiceMode: 'manual',
    });
    mock.tables.get('paymentMethods')!.set('cash-method', {
      id: 'cash-method',
      tenantId: 'tenant',
      name: 'Efectivo',
      type: 'cash',
      enabled: true,
      invoiceMode: 'manual',
    });
    for (const [id, methodId, name, amount] of [
      ['qr-payment', 'method', 'Mercado Pago QR', 2500],
      ['mp-payment', 'mp', 'Mercado Pago', 1500],
      ['cash-payment', 'cash-method', 'Efectivo', 1000],
    ] as const) {
      mock.tables.get('paymentTransactions')!.set(id, {
        id,
        tenantId: 'tenant',
        entryId: entry.id,
        paymentMethodId: methodId,
        paymentMethodName: name,
        amount,
      });
    }
    mock.preview.mockResolvedValue({ amount: 2500 });
    await render();
    await act(() =>
      Promise.resolve((historyRow() as HTMLTableRowElement).click()),
    );
    const section = container.querySelector('.entry-invoice-section')!;
    await click('Emitir factura', section);
    const rows = [
      ...section.querySelectorAll<HTMLLabelElement>(
        '.invoice-payment-selector__row',
      ),
    ];
    for (const name of ['Mercado Pago', 'Efectivo']) {
      act(() => {
        rows
          .find(
            (row) =>
              row.textContent?.includes(name) &&
              !row.textContent?.includes('QR'),
          )!
          .querySelector<HTMLInputElement>('input')!
          .click();
      });
    }
    await click('Emitir Factura C', section);
    expect(mock.preview).toHaveBeenCalledWith(
      expect.objectContaining({ invoicePaymentIds: ['qr-payment'] }),
    );
    expect(container.querySelector('.confirm-dialog')?.textContent).toContain(
      '2.500',
    );
    await click(
      'Emitir Factura C',
      container.querySelector('.confirm-dialog')!,
    );
    expect(mock.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAmount: 2500,
        invoicePaymentIds: ['qr-payment'],
      }),
    );
  });
  it('una factura parcial muestra el cobrado restante sin dar la estadía por totalmente facturada', async () => {
    mock.tables.get('entries')!.set(entry.id, {
      ...entry,
      leftAt,
      amountPaid: '5000',
    });
    mock.tables.get('paymentTransactions')!.set('qr-payment', {
      id: 'qr-payment',
      tenantId: 'tenant',
      entryId: entry.id,
      paymentMethodId: 'method',
      paymentMethodName: 'Mercado Pago QR',
      amount: 2500,
    });
    mock.tables.get('paymentTransactions')!.set('cash-payment', {
      id: 'cash-payment',
      tenantId: 'tenant',
      entryId: entry.id,
      paymentMethodId: 'method',
      paymentMethodName: 'Efectivo',
      amount: 2500,
    });
    mock.tables.get('invoices')!.set(invoice.id, {
      ...invoice,
      impTotal: 2500,
      selectedPaymentIds: ['qr-payment'],
    });
    await render();
    expect(historyRow().textContent).toContain('Factura parcial');
    expect(historyRow().textContent).toContain('2.500');
    await act(() =>
      Promise.resolve((historyRow() as HTMLTableRowElement).click()),
    );
    const section = container.querySelector('.entry-invoice-section')!;
    expect(section.textContent).toContain('Sin facturar');
    expect(section.textContent).toContain('2.500');
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
