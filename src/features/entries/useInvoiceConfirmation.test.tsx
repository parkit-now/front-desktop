// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/client';
import { useInvoiceConfirmation } from './useInvoiceConfirmation';

const mock = vi.hoisted(() => ({
  preview: vi.fn(),
  issue: vi.fn(),
  toast: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('./invoiceHistory', () => ({
  refreshInvoiceHistory: mock.refresh,
  INVOICE_HISTORY_REFRESH_WARNING: 'Actualizá el historial.',
}));
vi.mock('../../lib/api/arca', () => ({
  getInvoicePreview: mock.preview,
  issueInvoice: mock.issue,
}));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: mock.toast }),
}));

const receiver = {
  letter: 'C' as const,
  cuit: '20427205208',
  receiverName: 'Cliente',
};
let controller: ReturnType<typeof useInvoiceConfirmation>;
let root: Root;
let container: HTMLDivElement;
function Harness({ entryId = 'entry' }: { entryId?: string }) {
  controller = useInvoiceConfirmation({
    tenantId: 'tenant',
    entryId,
    bearer: 'token',
  });
  return null;
}

beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mock.preview.mockResolvedValue({ amount: 10 });
  mock.issue.mockResolvedValue({ id: 'invoice', status: 'issued' });
  mock.refresh.mockResolvedValue(true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(() => Promise.resolve(root.render(<Harness />)));
});
afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

describe('confirmacion del importe fiscal', () => {
  it('congela el importe y receptor consultados y envia exactamente lo confirmado', async () => {
    await act(async () => controller.open(receiver));
    expect(controller.snapshot).toEqual({ ...receiver, amount: 10 });
    const result = vi.fn();
    await act(async () => controller.confirm(result));
    expect(mock.issue).toHaveBeenCalledWith({
      tenantId: 'tenant',
      entryId: 'entry',
      bearer: 'token',
      receiverCuit: '20427205208',
      expectedAmount: 10,
    });
    expect(result).toHaveBeenCalledOnce();
    expect(mock.refresh).toHaveBeenCalledWith({
      tenantId: 'tenant',
      bearer: 'token',
    });
    expect(controller.snapshot).toBeNull();
  });

  it('cancelar no emite ni conserva una confirmacion anterior', async () => {
    await act(async () => controller.open(receiver));
    await act(() => Promise.resolve(controller.close()));
    await act(async () => controller.confirm(vi.fn()));
    expect(mock.issue).not.toHaveBeenCalled();
    expect(mock.refresh).not.toHaveBeenCalled();
    expect(controller.snapshot).toBeNull();
  });

  it('si falla la consulta no muestra un monto inventado ni permite emitir', async () => {
    mock.preview.mockRejectedValue(new Error('offline'));
    await act(async () => controller.open(receiver));
    await act(async () => controller.confirm(vi.fn()));
    expect(controller.snapshot).toBeNull();
    expect(controller.busy).toBe(false);
    expect(mock.issue).not.toHaveBeenCalled();
    expect(mock.toast).toHaveBeenCalledOnce();
  });

  it('un monto cambiado recarga el aviso, pero no reintenta emitir sin confirmar', async () => {
    await act(async () => controller.open(receiver));
    mock.issue.mockRejectedValueOnce(
      new ApiError(409, 'changed', {
        title: 'Conflict',
        status: 409,
        detail: 'changed',
        instance: '/invoice',
        code: 'INVOICE_AMOUNT_CHANGED',
      }),
    );
    mock.preview.mockResolvedValueOnce({ amount: 12.25 });
    await act(async () => controller.confirm(vi.fn()));
    expect(mock.issue).toHaveBeenCalledTimes(1);
    expect(controller.snapshot).toEqual({ ...receiver, amount: 12.25 });
    expect(mock.refresh).toHaveBeenCalledOnce();
    await act(async () => controller.confirm(vi.fn()));
    expect(mock.issue).toHaveBeenCalledTimes(2);
    expect(controller.snapshot).toBeNull();
  });

  it('si falla la recarga del nuevo importe cierra el aviso sin emitir otra vez', async () => {
    await act(async () => controller.open(receiver));
    mock.issue.mockRejectedValueOnce(
      new ApiError(409, 'changed', {
        title: 'Conflict',
        status: 409,
        detail: 'changed',
        instance: '/invoice',
        code: 'INVOICE_AMOUNT_CHANGED',
      }),
    );
    mock.preview.mockRejectedValueOnce(new Error('offline'));
    await act(async () => controller.confirm(vi.fn()));
    expect(controller.snapshot).toBeNull();
    expect(mock.issue).toHaveBeenCalledTimes(1);
    expect(controller.busy).toBe(false);
  });

  it('doble click no duplica consultas ni emisiones', async () => {
    let resolvePreview!: (value: { amount: number }) => void;
    mock.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    await act(async () => {
      const first = controller.open(receiver);
      const second = controller.open(receiver);
      resolvePreview({ amount: 10 });
      await Promise.all([first, second]);
    });
    expect(mock.preview).toHaveBeenCalledOnce();
    let resolveIssue!: (value: { id: string; status: string }) => void;
    mock.issue.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIssue = resolve;
        }),
    );
    await act(async () => {
      const first = controller.confirm(vi.fn());
      const second = controller.confirm(vi.fn());
      controller.close();
      resolveIssue({ id: 'invoice', status: 'issued' });
      await Promise.all([first, second]);
    });
    expect(mock.issue).toHaveBeenCalledOnce();
  });

  it('descarta una consulta tardia al cambiar de ingreso', async () => {
    let resolvePreview!: (value: { amount: number }) => void;
    mock.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    );
    let pending!: Promise<void>;
    await act(() => {
      pending = controller.open(receiver);
      return Promise.resolve();
    });
    await act(() =>
      Promise.resolve(root.render(<Harness entryId="other-entry" />)),
    );
    await act(async () => {
      resolvePreview({ amount: 100 });
      await pending;
    });
    expect(controller.snapshot).toBeNull();
    expect(controller.busy).toBe(false);
    expect(mock.issue).not.toHaveBeenCalled();
  });
  it('espera el refresco local antes de habilitar otra emision', async () => {
    let done!: (updated: boolean) => void;
    mock.refresh.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        done = resolve;
      }),
    );
    await act(async () => controller.open(receiver));
    let pending!: Promise<void>;
    await act(() => {
      pending = controller.confirm(vi.fn());
      return Promise.resolve();
    });
    expect(controller.busy).toBe(true);
    await act(async () => controller.confirm(vi.fn()));
    expect(mock.issue).toHaveBeenCalledOnce();
    await act(async () => {
      done(true);
      await pending;
    });
    expect(controller.busy).toBe(false);
  });
  it('un fallo de refresco no cambia una emision autorizada en fallida ni la repite', async () => {
    mock.refresh.mockResolvedValueOnce(false);
    await act(async () => controller.open(receiver));
    const result = vi.fn();
    await act(async () => controller.confirm(result));
    expect(result).toHaveBeenCalledWith({ id: 'invoice', status: 'issued' });
    expect(mock.toast).toHaveBeenCalledWith({
      message: 'Actualizá el historial.',
      kind: 'info',
    });
    expect(controller.busy).toBe(false);
    await act(async () => controller.confirm(result));
    expect(mock.issue).toHaveBeenCalledOnce();
  });
  it('actualiza Dexie aunque el operador cambie de ingreso durante la emision', async () => {
    let done!: (invoice: { id: string; status: string }) => void;
    mock.issue.mockReturnValueOnce(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    await act(async () => controller.open(receiver));
    const result = vi.fn();
    let pending!: Promise<void>;
    await act(() => {
      pending = controller.confirm(result);
      return Promise.resolve();
    });
    await act(() =>
      Promise.resolve(root.render(<Harness entryId="other-entry" />)),
    );
    await act(async () => {
      done({ id: 'invoice', status: 'issued' });
      await pending;
    });
    expect(mock.refresh).toHaveBeenCalledWith({
      tenantId: 'tenant',
      bearer: 'token',
    });
    expect(result).not.toHaveBeenCalled();
    expect(controller.snapshot).toBeNull();
  });
});
