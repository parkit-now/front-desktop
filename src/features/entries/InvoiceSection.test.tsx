// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalEntry } from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { InvoiceSection } from './InvoiceSection';
vi.mock('./useArcaEmitter', () => ({
  useArcaEmitterState: () => ({ accounts: [] }),
  toArcaEmitter: () => null,
}));

const mock = vi.hoisted(() => ({
  invoice: {
    id: 'invoice-1',
    status: 'issued',
    cbteTipo: 11,
    ptoVta: 7,
    cbteNro: 9,
    cae: '86406602350114',
    receptorDocTipo: 99,
  },
  document: vi.fn(),
  render: vi.fn(),
  save: vi.fn(),
  reveal: vi.fn(),
  toast: vi.fn(),
  qr: vi.fn(),
  correct: vi.fn(),
  entryUpdate: vi.fn(),
  invoiceUpdate: vi.fn(),
  transaction: vi.fn(async (...args: unknown[]) => {
    const callback = args[args.length - 1] as () => Promise<void>;
    await callback();
  }),
}));
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));
vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    invoices: {
      where: () => ({ equals: () => ({ first: () => mock.invoice }) }),
      update: mock.invoiceUpdate,
    },
    entries: { get: () => undefined, update: mock.entryUpdate },
    paymentTransactions: {
      where: () => ({
        equals: () => ({
          filter: () => ({
            toArray: () => [
              {
                id: 'payment-1',
                entryId: 'entry-1',
                paymentMethodId: 'method-1',
                paymentMethodName: 'Efectivo',
                amount: 12000,
              },
            ],
          }),
        }),
      }),
    },
    paymentMethods: {
      where: () => ({
        equals: () => ({
          toArray: () => [{ id: 'method-1', invoiceMode: 'manual' }],
        }),
      }),
    },
    transaction: mock.transaction,
    clients: { where: () => ({ equals: () => ({ toArray: () => [] }) }) },
  },
}));
vi.mock('../../lib/api/arca', () => ({ getInvoiceDocument: mock.document }));
vi.mock('../../lib/api/entries', () => ({ correctEntry: mock.correct }));
vi.mock('../../lib/sync/SyncService', () => ({
  syncService: {
    pullInvoices: vi.fn(),
    pullClients: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('../../lib/sync/enqueue', () => ({ enqueuePendingOp: vi.fn() }));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: mock.toast }),
}));
vi.mock('qrcode', () => ({ default: { toDataURL: mock.qr } }));
vi.mock('./invoiceDocument', () => ({
  renderInvoiceHtml: () => '<html>Factura</html>',
}));
vi.mock('./useInvoiceReceiver', () => ({
  useInvoiceReceiver: () => ({
    choice: 'final',
    lookup: { status: 'idle' },
    ready: true,
  }),
}));
vi.mock('./useInvoiceConfirmation', () => ({
  useInvoiceConfirmation: () => ({ busy: false, snapshot: null }),
}));

const entry: LocalEntry = {
  id: 'entry-1',
  tenantId: 'tenant',
  plate: 'IXO431',
  enteredAt: '2026-10-07T11:00:00Z',
  leftAt: '2026-10-07T16:00:00Z',
  version: 1,
  syncSeq: 1,
  updatedAt: '2026-10-07T16:00:00Z',
};
let root: Root;
let container: HTMLDivElement;
let previousDesktop: PropertyDescriptor | undefined;
async function update(callback: () => void | Promise<void>) {
  await act(async () => {
    await callback();
  });
}
async function render(
  online = true,
  current = entry,
  emitter: { condicionIva: 'monotributo'; certExpired: boolean } | null = null,
  actorRole: 'owner' | 'operator' = 'owner',
  invoiceModeAllowed = true,
) {
  await update(() =>
    root.render(
      <InvoiceSection
        entry={current}
        paymentLines={[
          {
            id: 'payment-1',
            tenantId: 'tenant',
            entryId: current.id,
            paymentMethodId: 'method-1',
            paymentMethodName: 'Efectivo',
            amount: 12000,
            version: 1,
            syncSeq: 1,
            updatedAt: entry.updatedAt,
          },
        ]}
        paidTotal={12000}
        tenantId="tenant"
        accessToken="token"
        isOnline={online}
        emitter={emitter}
        actorRole={actorRole}
        invoiceModeAllowed={invoiceModeAllowed}
      />,
    ),
  );
}
function folderButton() {
  return container.querySelector<HTMLButtonElement>(
    '[aria-label="Mostrar PDF en carpeta"]',
  );
}
async function download() {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent === 'Descargar PDF',
  )!;
  await update(() => button.click());
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mock.invoice.id = 'invoice-1';
  mock.invoice.status = 'issued';
  mock.document.mockResolvedValue({ qrUrl: 'https://example.test/qr' });
  mock.qr.mockResolvedValue('data:image/png;base64,qr');
  mock.render.mockResolvedValue({ ok: true, data: new Uint8Array([1, 2]) });
  mock.save.mockResolvedValue({ ok: true, path: '/tmp/factura.pdf' });
  mock.reveal.mockResolvedValue({ ok: true });
  mock.entryUpdate.mockResolvedValue(1);
  mock.invoiceUpdate.mockResolvedValue(1);
  previousDesktop = Object.getOwnPropertyDescriptor(window, 'parkitDesktop');
  Object.defineProperty(window, 'parkitDesktop', {
    configurable: true,
    value: {
      renderPdf: mock.render,
      saveFile: mock.save,
      showSavedFileInFolder: mock.reveal,
    },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await update(() => root.unmount());
  container.remove();
  if (previousDesktop)
    Object.defineProperty(window, 'parkitDesktop', previousDesktop);
  else Reflect.deleteProperty(window, 'parkitDesktop');
});

describe('acceso a la carpeta del PDF', () => {
  it('aparece despues de guardar y muestra el archivo exacto incluso sin conexion', async () => {
    await render();
    expect(folderButton()).toBeNull();
    await download();
    expect(mock.save).toHaveBeenCalledWith({
      defaultName: '00000009-0007_86406602350114_IXO431.pdf',
      data: new Uint8Array([1, 2]),
    });
    expect(folderButton()).not.toBeNull();
    await render(false);
    expect(folderButton()!.disabled).toBe(false);
    expect(container.textContent).toContain(
      'Necesitás conexión para descargar el PDF.',
    );
    await update(() => folderButton()!.click());
    expect(mock.reveal).toHaveBeenCalledWith('/tmp/factura.pdf');
  });

  it('cancelar el guardado no muestra el acceso ni informa exito', async () => {
    mock.save.mockResolvedValue({ ok: false, reason: 'canceled' });
    await render();
    await download();
    expect(folderButton()).toBeNull();
    expect(mock.toast).not.toHaveBeenCalled();
  });

  it('un fallo al guardar no muestra el acceso', async () => {
    mock.save.mockResolvedValue({
      ok: false,
      reason: 'write-failed',
      detail: 'denied',
    });
    await render();
    await download();
    expect(folderButton()).toBeNull();
    expect(mock.toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error' }),
    );
  });

  it('no muestra la ruta de otra factura al cambiar de movimiento', async () => {
    await render();
    await download();
    mock.invoice.id = 'invoice-2';
    await render(true, { ...entry, id: 'entry-2' });
    expect(folderButton()).toBeNull();
  });

  it('recuerda la ultima descarga exitosa y no la reemplaza al cancelar', async () => {
    await render();
    await download();
    mock.save.mockResolvedValueOnce({
      ok: true,
      path: '/tmp/otra-factura.pdf',
    });
    await download();
    mock.save.mockResolvedValueOnce({ ok: false, reason: 'canceled' });
    await download();
    await update(() => folderButton()!.click());
    expect(mock.reveal).toHaveBeenCalledWith('/tmp/otra-factura.pdf');
  });

  it('informa un archivo movido o un error IPC y deja volver a intentar', async () => {
    await render();
    await download();
    mock.toast.mockClear();
    mock.reveal.mockResolvedValueOnce({ ok: false });
    await update(() => folderButton()!.click());
    expect(mock.toast).toHaveBeenCalledWith({
      message: 'No se pudo encontrar o abrir el PDF guardado.',
      kind: 'error',
    });
    expect(folderButton()!.disabled).toBe(false);
    mock.reveal.mockRejectedValueOnce(new Error('IPC'));
    await update(() => folderButton()!.click());
    expect(mock.toast).toHaveBeenCalledTimes(2);
  });

  it('bloquea el doble clic mientras se abre la carpeta', async () => {
    let resolve!: (result: { ok: boolean }) => void;
    mock.reveal.mockReturnValue(
      new Promise<{ ok: boolean }>((done) => {
        resolve = done;
      }),
    );
    await render();
    await download();
    await update(() => folderButton()!.click());
    expect(folderButton()!.disabled).toBe(true);
    await update(() => folderButton()!.click());
    await update(() => resolve({ ok: true }));
    expect(mock.reveal).toHaveBeenCalledOnce();
    expect(folderButton()!.disabled).toBe(false);
  });
});

describe('factura manual', () => {
  it('muestra el número guardado y permite corregirlo desde el detalle', async () => {
    mock.invoice.status = 'not_required';
    await render(true, {
      ...entry,
      manuallyInvoiced: true,
      manualInvoiceNumber: '0001-00000042',
    });

    expect(container.textContent).toContain('Facturada');
    const number = container.querySelector<HTMLInputElement>(
      'input[id^="manual-invoice-number-"]',
    );
    expect(number?.value).toBe('0001-00000042');
    expect(
      container.querySelector('[aria-label="Guardar número de factura"]'),
    ).not.toBeNull();
  });
});

describe('seguimiento de factura', () => {
  function option(label: string) {
    return Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        '.entry-invoice-reminder-options button',
      ),
    ).find((button) => button.textContent?.includes(label));
  }

  it('solo el dueño puede alternar entre pendiente y no facturado', async () => {
    mock.invoice.status = 'pending';
    await render(true, entry, null, 'operator');
    expect(option('No facturado')).toBeUndefined();

    await render(true, entry, null, 'owner');
    expect(option('Pendiente')?.getAttribute('aria-pressed')).toBe('true');
    mock.correct.mockResolvedValue({ ...entry, version: 2, syncSeq: 2 });
    await update(() => option('No facturado')!.click());
    expect(mock.correct).toHaveBeenCalledWith({
      tenantId: 'tenant',
      entryId: 'entry-1',
      expectedVersion: 1,
      bearer: 'token',
      body: { invoicePending: false },
    });
    expect(mock.entryUpdate).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ invoiceStatusOverride: 'none' }),
    );
  });

  it('encola el cambio offline y lo refleja en Dexie', async () => {
    mock.invoice.status = 'not_required';
    await render(false);
    expect(option('No facturado')?.getAttribute('aria-pressed')).toBe('true');
    await update(() => option('Pendiente')!.click());
    expect(mock.entryUpdate).toHaveBeenCalledWith(
      'entry-1',
      expect.objectContaining({ invoiceStatusOverride: 'pending', version: 2 }),
    );
    expect(enqueuePendingOp).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'entry',
        entityId: 'entry-1',
        payload: {
          kind: 'correction',
          expectedVersion: 1,
          body: { invoicePending: true },
        },
      }),
    );
  });

  it('no muestra el control en facturas emitidas', async () => {
    await render();
    expect(option('Pendiente')).toBeUndefined();
  });
});

describe('factura externa con ARCA', () => {
  const emitter = { condicionIva: 'monotributo', certExpired: false } as const;

  it.each(['nombre', 'cuit'])(
    'registra otro emisor solo con %s sin vincular una cuenta',
    async (field) => {
      mock.invoice.status = 'pending';
      const issuer =
        field === 'nombre'
          ? {
              manualInvoiceIssuerName: 'Emisor tercero',
              manualInvoiceIssuerCuit: null,
            }
          : {
              manualInvoiceIssuerName: null,
              manualInvoiceIssuerCuit: '20123456786',
            };
      mock.correct.mockResolvedValue({
        ...entry,
        manuallyInvoiced: true,
        manualInvoiceType: 'C',
        manualInvoicePointOfSale: '12',
        manualInvoiceNumber: '123',
        manualInvoiceArcaAccountId: null,
        ...issuer,
      });
      await render(
        true,
        {
          ...entry,
          manualInvoicePointOfSale: '12',
          manualInvoiceNumber: '123',
        },
        emitter,
      );
      const button = (label: string) =>
        [...container.querySelectorAll('button')].find(
          (item) => item.textContent === label,
        )!;
      await update(() => button('Registrar factura externa').click());
      expect(container.querySelector('.entry-invoice-account')).toBeNull();
      await update(() =>
        container
          .querySelector<HTMLInputElement>(
            '.entry-external-issuer-toggle input',
          )!
          .click(),
      );
      expect(button('Guardar factura externa').disabled).toBe(true);
      const input = [
        ...container.querySelectorAll('.entry-external-issuer-fields label'),
      ]
        .find((label) =>
          label.textContent?.includes(field === 'nombre' ? 'Nombre' : 'CUIT'),
        )!
        .querySelector('input')!;
      await update(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!.call(
          input,
          field === 'nombre' ? ' Emisor tercero ' : '20-12345678-6',
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(button('Guardar factura externa').disabled).toBe(false);
      await update(() => button('Guardar factura externa').click());
      const request = mock.correct.mock.calls[0]?.[0] as {
        body: Record<string, unknown>;
      };
      expect(request.body).toMatchObject({
        manuallyInvoiced: true,
        manualInvoiceArcaAccountId: null,
        ...issuer,
      });
      expect(mock.entryUpdate).toHaveBeenCalledWith(
        entry.id,
        expect.objectContaining({
          manualInvoiceArcaAccountId: undefined,
          manualInvoiceIssuerName: issuer.manualInvoiceIssuerName ?? undefined,
          manualInvoiceIssuerCuit: issuer.manualInvoiceIssuerCuit ?? undefined,
        }),
      );
    },
  );

  it('muestra el emisor aunque solo se haya cargado su nombre', async () => {
    await render(
      true,
      {
        ...entry,
        manuallyInvoiced: true,
        manualInvoiceIssuerName: 'Emisor tercero',
      },
      emitter,
    );
    expect(container.textContent).toContain('Emisor tercero');
    expect(container.textContent).not.toContain('· CUIT');
  });

  it('no ofrece emitir si el medio tiene la facturación desactivada', async () => {
    mock.invoice.status = 'not_required';
    await render(true, entry, emitter, 'owner', false);
    expect(container.textContent).not.toContain('Emitir factura');
  });

  it('sólo el dueño online puede abrir el registro de una pendiente', async () => {
    mock.invoice.status = 'pending';
    await render(true, entry, emitter, 'operator');
    expect(container.textContent).not.toContain('Registrar factura externa');

    await render(false, entry, emitter);
    const offlineButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Registrar factura externa',
    );
    expect(offlineButton?.disabled).toBe(true);

    await render(true, entry, emitter);
    expect(
      Array.from(
        container.querySelectorAll('.entry-invoice-actions--choices > button'),
        (item) => item.textContent,
      ),
    ).toEqual(['Registrar factura externa', 'Emitir factura']);
    const button = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Registrar factura externa',
    );
    expect(button?.disabled).toBe(false);
    await update(() => button!.click());
    expect(container.textContent).toContain('Punto de venta');
    expect(container.textContent).toContain('Número');
    expect(container.textContent).not.toContain('Emitir factura');
  });

  it('una externa registrada se ve facturada y ya no ofrece emitir', async () => {
    mock.invoice.status = 'pending';
    const externalEntry = {
      ...entry,
      manuallyInvoiced: true,
      manualInvoiceType: 'C' as const,
      manualInvoicePointOfSale: '12',
      manualInvoiceNumber: '123',
    };
    await render(true, externalEntry, emitter);
    expect(container.textContent).toContain('Facturada');
    expect(container.textContent).toContain('Factura C 00012-00000123');
    expect(container.textContent).not.toContain('Emitir factura');

    await render(true, externalEntry, emitter, 'operator');
    expect(container.textContent).toContain('Factura C 00012-00000123');
    expect(container.textContent).not.toContain('Editar factura externa');
    expect(container.textContent).not.toContain('Quitar registro');
  });

  it('guarda los tres datos juntos y cierra el pendiente local confirmado', async () => {
    mock.invoice.status = 'pending';
    mock.correct.mockResolvedValue({
      ...entry,
      manuallyInvoiced: true,
      manualInvoiceType: 'C',
      manualInvoicePointOfSale: '12',
      manualInvoiceNumber: '123',
    });
    await render(
      true,
      {
        ...entry,
        manualInvoiceType: 'C',
        manualInvoicePointOfSale: '12',
        manualInvoiceNumber: '123',
      },
      emitter,
    );
    const button = (label: string) =>
      Array.from(container.querySelectorAll('button')).find(
        (item) => item.textContent === label,
      );
    await update(() => button('Registrar factura externa')!.click());
    await update(() => button('Guardar factura externa')!.click());

    expect(mock.correct).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          manuallyInvoiced: true,
          manualInvoiceType: 'C',
          manualInvoicePointOfSale: '12',
          manualInvoiceNumber: '123',
        },
      }),
    );
    expect(mock.invoiceUpdate).toHaveBeenCalledWith('invoice-1', {
      status: 'not_required',
      errorCode: null,
      errorMessage: null,
    });
  });
});
