// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalCashSession } from '../../lib/db/localDb';
import type { CashSessionPrintData } from '../../lib/print/cashSessionSummary';
import { CloseCashSessionDialog } from './CloseCashSessionDialog';

const mock = vi.hoisted(() => ({
  close: vi.fn(),
  print: vi.fn(),
  toast: vi.fn(),
  onClose: vi.fn(),
  transactions: [
    {
      id: 'tx-1',
      cashSessionId: 'session',
      paymentMethodId: 'cash',
      paymentMethodName: 'Efectivo',
      paymentMethodType: 'cash',
      amount: 5000,
    },
  ],
}));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => mock.transactions,
}));
vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    paymentTransactions: {
      where: () => ({
        equals: () => ({ toArray: () => Promise.resolve(mock.transactions) }),
      }),
    },
    entries: {
      where: () => ({
        equals: () => ({
          filter: () => ({ toArray: () => Promise.resolve([]) }),
        }),
      }),
      update: vi.fn(),
    },
    cashSessions: { put: vi.fn() },
    transaction: async (_mode: string, ...args: unknown[]) =>
      (args.at(-1) as () => Promise<void>)(),
  },
}));
vi.mock('../../lib/api/cash-sessions', () => ({
  closeCashSession: mock.close,
}));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: mock.toast }),
}));
vi.mock('../../lib/print/cashSessionSummary', () => ({
  printCashSessionSummary: mock.print,
  describeCashSummaryPrintFailure: () => 'No hay impresoras instaladas.',
}));

const session: LocalCashSession = {
  id: 'session',
  tenantId: 'tenant',
  openedAt: '2026-10-10T12:00:00Z',
  openingCash: 100,
  version: 1,
  syncSeq: 1,
  updatedAt: '2026-10-10T12:00:00Z',
};

let root: Root;
let container: HTMLDivElement;

async function render() {
  await act(() =>
    Promise.resolve(
      root.render(
        <CloseCashSessionDialog
          tenantId="tenant"
          accessToken="token"
          parkingName="Apex"
          session={session}
          onClose={mock.onClose}
        />,
      ),
    ),
  );
}

async function close() {
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === 'Cerrar caja',
  )!;
  await act(() => Promise.resolve(button.click()));
}

function printCheckbox(): HTMLInputElement {
  return [
    ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ].find((input) =>
    input.parentElement?.textContent?.includes('Imprimir resumen'),
  )!;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mock.close.mockResolvedValue({
    closedSession: {
      ...session,
      closedAt: '2026-10-10T20:00:00Z',
      leavingCash: 0,
      notes: null,
    },
    newSession: null,
    carriedOverCount: 0,
  });
  mock.print.mockResolvedValue({ ok: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

describe('impresión opcional al cerrar la caja', () => {
  it('no imprime cuando la casilla está desmarcada', async () => {
    await render();
    await close();
    expect(mock.close).toHaveBeenCalledOnce();
    expect(mock.print).not.toHaveBeenCalled();
    expect(mock.onClose).toHaveBeenCalledOnce();
  });

  it('imprime el resumen confirmado tras cerrar la caja', async () => {
    await render();
    await act(() => Promise.resolve(printCheckbox().click()));
    await close();
    expect(mock.print).toHaveBeenCalledOnce();
    const printed = mock.print.mock.calls[0][0] as CashSessionPrintData;
    expect(printed.parkingName).toBe('Apex');
    expect(printed.closedAt).toBe('2026-10-10T20:00:00Z');
    expect(printed.summary.grandTotal).toBe(5000);
    expect(printed.summary.cashTotal).toBe(5100);
    expect(mock.onClose).toHaveBeenCalledOnce();
  });

  it('mantiene el cierre exitoso aunque falle la impresora', async () => {
    mock.print.mockResolvedValue({ ok: false, reason: 'no-printer' });
    await render();
    await act(() => Promise.resolve(printCheckbox().click()));
    await close();
    expect(mock.close).toHaveBeenCalledOnce();
    expect(mock.onClose).toHaveBeenCalledOnce();
    const toast = mock.toast.mock.calls[0][0] as {
      message: string;
      kind: string;
    };
    expect(toast.message).toContain('Caja cerrada. No hay impresoras');
    expect(toast.kind).toBe('error');
  });
});
