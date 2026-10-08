// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PaymentIntentDto } from '../../lib/api/payment-intents';
import { ApiError } from '../../lib/api/client';
import { useMercadoPagoIntent } from './useMercadoPagoIntent';

const mock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('../../lib/api/payment-intents', () => ({
  listUnconsumedPaymentIntents: mock.list,
  createPaymentIntent: mock.create,
  getPaymentIntent: mock.get,
  cancelPaymentIntent: mock.cancel,
  isTerminalIntentStatus: (status: string) =>
    !['created', 'pending', 'approved'].includes(status),
}));

const approved: PaymentIntentDto = {
  id: 'intent-id',
  tenantId: 'tenant-id',
  entryId: 'entry-id',
  status: 'approved',
  amount: 4800,
  createdAt: '2026-10-08T15:47:29.000Z',
  updatedAt: '2026-10-08T15:47:59.000Z',
  expiresAt: '2026-10-08T15:52:29.000Z',
  approvedAt: '2026-10-08T15:47:59.000Z',
};

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useMercadoPagoIntent>;

function Harness({ isOnline = true }: { isOnline?: boolean }) {
  state = useMercadoPagoIntent({
    tenantId: 'tenant-id',
    accessToken: 'token',
    entryId: 'entry-id',
    amount: 5600,
    isOnline,
  });
  return <button onClick={() => void state.start()}>Cobrar con QR</button>;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mock.list.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
});

it('recupera el QR aprobado al reabrir sin generar otro cobro', async () => {
  mock.list.mockResolvedValue([approved]);
  await act(() => Promise.resolve(root.render(<Harness />)));

  expect(state.intent).toEqual(approved);
  expect(state.view?.canConfirm).toBe(true);
  expect(state.isRestoring).toBe(false);
  expect(mock.create).not.toHaveBeenCalled();
});

it('ante un 409 de intento abierto vuelve a buscar el pago acreditado', async () => {
  mock.list.mockResolvedValueOnce([]).mockResolvedValueOnce([approved]);
  mock.create.mockRejectedValue(
    Object.assign(new ApiError(409, 'Already open', null), {
      problem: { code: 'PAYMENT_INTENT_ALREADY_OPEN' },
    }),
  );
  await act(() => Promise.resolve(root.render(<Harness />)));
  await act(() => Promise.resolve(container.querySelector('button')?.click()));

  expect(state.intent).toEqual(approved);
  expect(state.errorMessage).toBeNull();
  expect(mock.list).toHaveBeenCalledTimes(2);
});

it('no consulta cobros al abrir sin conexion', async () => {
  await act(() => Promise.resolve(root.render(<Harness isOnline={false} />)));
  expect(state.isRestoring).toBe(false);
  expect(mock.list).not.toHaveBeenCalled();
});
