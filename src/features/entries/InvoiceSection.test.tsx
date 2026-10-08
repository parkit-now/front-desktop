// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalEntry } from '../../lib/db/localDb';
import { InvoiceSection } from './InvoiceSection';

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
}));
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));
vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    invoices: {
      where: () => ({ equals: () => ({ first: () => mock.invoice }) }),
    },
    entries: { get: () => undefined },
    clients: { where: () => ({ equals: () => ({ toArray: () => [] }) }) },
  },
}));
vi.mock('../../lib/api/arca', () => ({ getInvoiceDocument: mock.document }));
vi.mock('../../lib/api/entries', () => ({ correctEntry: vi.fn() }));
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
async function render(online = true, current = entry) {
  await update(() =>
    root.render(
      <InvoiceSection
        entry={current}
        paidTotal={12000}
        tenantId="tenant"
        accessToken="token"
        isOnline={online}
        emitter={null}
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

    expect(container.textContent).toContain('Facturada a mano');
    const number = container.querySelector<HTMLInputElement>(
      'input[id^="manual-invoice-number-"]',
    );
    expect(number?.value).toBe('0001-00000042');
    expect(
      container.querySelector('[aria-label="Guardar número de factura"]'),
    ).not.toBeNull();
  });
});
