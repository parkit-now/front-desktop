// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInvoiceReceiver } from './useInvoiceReceiver';
import { InvoiceReceiverChooser } from './InvoiceReceiverChooser';
import { MercadoPagoQrPanel } from './MercadoPagoQrPanel';

const mock = vi.hoisted(() => ({
  suggestion: vi.fn(),
  lookup: vi.fn(),
  list: vi.fn(),
  entries: vi.fn(),
  invoices: vi.fn(),
  clientRows: [] as
    | { plates: string[]; cuit: string | null; deletedAt: null }[]
    | undefined,
  history: vi.fn(),
}));
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => mock.clientRows,
}));
vi.mock('../../lib/api/arca', () => ({
  getInvoiceReceiverSuggestion: mock.suggestion,
  lookupTaxpayer: mock.lookup,
  listInvoiceReceivers: mock.list,
}));
vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    entries: {
      where: () => ({
        equals: () => ({ filter: () => ({ toArray: mock.entries }) }),
      }),
    },
    invoices: { where: () => ({ equals: () => ({ toArray: mock.invoices }) }) },
  },
}));
vi.mock('./invoiceUtils', async (original) => ({
  ...(await original<typeof import('./invoiceUtils')>()),
  latestInvoiceReceiverForPlate: mock.history,
}));

const CUIT = '20427205208';
const HISTORY_CUIT = '30712345671';
let receiver: ReturnType<typeof useInvoiceReceiver>;
let root: Root;
let container: HTMLDivElement;
type Input = Parameters<typeof useInvoiceReceiver>[0];
let input: Input;
async function update(callback: () => void | Promise<void>) {
  await act(async () => {
    await callback();
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve(value);
      return Promise.resolve();
    },
  };
}
function Harness({ value, qr = false }: { value: Input; qr?: boolean }) {
  receiver = useInvoiceReceiver(value);
  return qr ? (
    <MercadoPagoQrPanel
      amount={100}
      view={{
        tone: 'ok',
        title: 'Pago acreditado',
        detail: 'Listo',
        canConfirm: true,
        canCancel: false,
        canRetry: false,
        showCountdown: false,
      }}
      secondsLeft={0}
      isCanceling={false}
      isConfirming={false}
      confirmDisabled={!receiver.ready}
      onCancel={() => {}}
      onRetry={() => {}}
      onUseAnotherMethod={() => {}}
      onConfirm={() => {}}
    >
      <InvoiceReceiverChooser
        receiver={receiver}
        emitter="monotributo"
        isOnline
        disabled={false}
      />
    </MercadoPagoQrPanel>
  ) : null;
}
async function render(patch: Partial<Input> = {}, qr = false) {
  input = { ...input, ...patch };
  await act(async () => {
    root.render(<Harness value={input} qr={qr} />);
    await Promise.resolve();
  });
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.resetAllMocks();
  mock.suggestion.mockResolvedValue({ cuit: null });
  mock.entries.mockResolvedValue([]);
  mock.invoices.mockResolvedValue([]);
  mock.clientRows = [];
  mock.history.mockReturnValue(null);
  mock.list.mockResolvedValue([]);
  mock.lookup.mockResolvedValue({
    identified: true,
    razonSocial: 'Cliente',
    condicionIva: 'monotributo',
  });
  input = {
    tenantId: `tenant-${Math.random()}`,
    accessToken: 'token',
    isOnline: true,
    plate: 'ABC123',
    entryId: 'entry',
    paymentIntentId: 'intent',
    suggestionEnabled: true,
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await update(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useInvoiceReceiver: CUIT del QR', () => {
  it('prefiere el cliente al historial de la patente', async () => {
    mock.clientRows = [{ plates: ['ABC123'], cuit: CUIT, deletedAt: null }];
    mock.history.mockReturnValue({ cuit: HISTORY_CUIT });
    await render({ suggestionEnabled: false });
    expect(receiver.choice).toBe('cuit');
    expect(receiver.cuit).toBe(CUIT);
    expect(mock.history).not.toHaveBeenCalled();
  });

  it('respeta un CUIT borrado deliberadamente en la ficha', async () => {
    mock.clientRows = [{ plates: ['ABC123'], cuit: null, deletedAt: null }];
    mock.history.mockReturnValue({ cuit: HISTORY_CUIT });
    await render({ suggestionEnabled: false });
    expect(receiver.choice).toBe('final');
    expect(mock.history).not.toHaveBeenCalled();
  });

  it('autocompleta una ficha que llega despues de abrir el selector y tocar Con CUIT', async () => {
    mock.clientRows = undefined;
    await render({ suggestionEnabled: false });
    act(() => receiver.setChoice('cuit'));
    expect(receiver.cuit).toBe('');

    mock.clientRows = [{ plates: ['ABC123'], cuit: CUIT, deletedAt: null }];
    await render();
    expect(receiver.choice).toBe('cuit');
    expect(receiver.cuit).toBe(CUIT);
  });

  it('reintenta el autocompletado si la lectura llega durante el guardado', async () => {
    mock.clientRows = [{ plates: ['ABC123'], cuit: CUIT, deletedAt: null }];
    await render({ suggestionEnabled: false, frozen: true });
    expect(receiver.choice).toBe('final');
    await render({ frozen: false });
    expect(receiver.cuit).toBe(CUIT);
  });

  it('no pisa Consumidor Final elegido explicitamente antes de leer la ficha', async () => {
    mock.clientRows = undefined;
    await render({ suggestionEnabled: false });
    act(() => receiver.setChoice('final'));
    mock.clientRows = [{ plates: ['ABC123'], cuit: CUIT, deletedAt: null }];
    await render();
    expect(receiver.choice).toBe('final');
    expect(receiver.cuit).toBe('');
  });
  it('autocompleta Con CUIT y consulta el padron antes de habilitar', async () => {
    mock.suggestion.mockResolvedValue({ cuit: CUIT });
    await render();
    expect(receiver.choice).toBe('cuit');
    expect(receiver.cuit).toBe(CUIT);
    expect(receiver.source).toBe('mercadopago');
    expect(receiver.suggestionUnavailable).toBe(false);
    expect(receiver.ready).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(mock.lookup).toHaveBeenCalledWith({
      tenantId: input.tenantId,
      cuit: CUIT,
      bearer: 'token',
    });
    expect(receiver.ready).toBe(true);
    expect(receiver.cuitToSend).toBe(CUIT);
  });

  it('QR gana al historial aunque la lectura local llegue despues', async () => {
    const history = deferred<unknown[]>();
    mock.entries.mockReturnValue(history.promise);
    mock.history.mockReturnValue({ cuit: HISTORY_CUIT });
    mock.suggestion.mockResolvedValue({ cuit: CUIT });
    await render();
    await update(() => history.resolve([]));
    expect(receiver.cuit).toBe(CUIT);
  });

  it('QR reemplaza un CUIT historico ya autocompletado', async () => {
    const suggestion = deferred<{ cuit: string }>();
    mock.history.mockReturnValue({ cuit: HISTORY_CUIT });
    mock.suggestion.mockReturnValue(suggestion.promise);
    await render();
    expect(receiver.cuit).toBe(HISTORY_CUIT);
    expect(receiver.ready).toBe(false);
    await update(() => suggestion.resolve({ cuit: CUIT }));
    expect(receiver.cuit).toBe(CUIT);
  });

  it('elegir consumidor final manualmente permite seguir sin esperar y no se pisa', async () => {
    const suggestion = deferred<{ cuit: string }>();
    mock.suggestion.mockReturnValue(suggestion.promise);
    await render();
    expect(receiver.ready).toBe(false);
    await act(async () => {
      receiver.setChoice('final');
      await Promise.resolve();
    });
    expect(receiver.ready).toBe(true);
    expect(receiver.suggestionUnavailable).toBe(false);
    await update(() => suggestion.resolve({ cuit: CUIT }));
    expect(receiver.choice).toBe('final');
    expect(receiver.cuit).toBe('');
    expect(receiver.source).toBe(null);
  });

  it('no pisa una edicion manual del CUIT ni elige sobre el operador antes del QR', async () => {
    await render({ suggestionEnabled: false });
    await act(async () => {
      receiver.setChoice('cuit');
      receiver.setCuit(HISTORY_CUIT);
      await Promise.resolve();
    });
    await render({ suggestionEnabled: true });
    expect(mock.suggestion).not.toHaveBeenCalled();
    expect(receiver.cuit).toBe(HISTORY_CUIT);
  });

  it('vence a los cinco segundos, aborta y descarta respuestas posteriores sin reintentar', async () => {
    const suggestion = deferred<{ cuit: string }>();
    mock.suggestion.mockReturnValue(suggestion.promise);
    await render();
    const signal = (mock.suggestion.mock.calls[0][0] as { signal: AbortSignal })
      .signal;
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(receiver.ready).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(signal.aborted).toBe(true);
    expect(receiver.ready).toBe(true);
    expect(receiver.suggestionUnavailable).toBe(true);
    await update(() => suggestion.resolve({ cuit: CUIT }));
    expect(receiver.choice).toBe('final');
    await render({ accessToken: 'renewed' });
    await render({ isOnline: false });
    await render({ isOnline: true });
    expect(mock.suggestion).toHaveBeenCalledTimes(1);
  });

  it.each([null, '20427205209'])(
    'sin CUIT valido conserva el historico: %s',
    async (cuit) => {
      mock.history.mockReturnValue({ cuit: HISTORY_CUIT });
      mock.suggestion.mockResolvedValue({ cuit });
      await render();
      expect(receiver.cuit).toBe(HISTORY_CUIT);
      expect(receiver.source).toBe(null);
    },
  );

  it('fallo del proveedor no bloquea ni reintenta', async () => {
    mock.suggestion.mockRejectedValue(new Error('unreachable'));
    await render();
    expect(receiver.ready).toBe(true);
    expect(receiver.suggestionUnavailable).toBe(true);
    await render();
    expect(mock.suggestion).toHaveBeenCalledTimes(1);
  });

  it('solo atribuye a Mercado Pago la falta de CUIT en el QR actual', async () => {
    await render({}, true);
    expect(container.textContent).toContain(
      'No se pudo obtener un CUIT verificado de Mercado Pago',
    );
    await render({ paymentIntentId: undefined }, true);
    expect(receiver.suggestionUnavailable).toBe(false);
    expect(container.textContent).not.toContain(
      'No se pudo obtener un CUIT verificado de Mercado Pago',
    );
  });

  it('offline no consulta ni autocompleta', async () => {
    mock.suggestion.mockResolvedValue({ cuit: CUIT });
    mock.history.mockReturnValue({ cuit: HISTORY_CUIT });
    await render({ isOnline: false });
    expect(mock.suggestion).not.toHaveBeenCalled();
    expect(receiver.choice).toBe('final');
    expect(receiver.ready).toBe(true);
  });

  it('cancelar y reabrir descarta la respuesta de la apertura anterior', async () => {
    const first = deferred<{ cuit: string }>();
    mock.suggestion
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ cuit: HISTORY_CUIT });
    await render();
    await render({ suggestionEnabled: false });
    await render({ suggestionEnabled: true });
    await update(() => first.resolve({ cuit: CUIT }));
    expect(receiver.cuit).toBe(HISTORY_CUIT);
  });

  it('cambiar ingreso, intento o tenant invalida respuestas anteriores', async () => {
    const first = deferred<{ cuit: string }>();
    mock.suggestion
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ cuit: HISTORY_CUIT });
    await render();
    await render({
      tenantId: 'other',
      entryId: 'other',
      paymentIntentId: 'other',
    });
    await update(() => first.resolve({ cuit: CUIT }));
    expect(receiver.cuit).toBe(HISTORY_CUIT);
  });

  it('no cambia el receptor de una confirmacion abierta', async () => {
    const suggestion = deferred<{ cuit: string }>();
    mock.suggestion.mockReturnValue(suggestion.promise);
    await render();
    await render({ frozen: true });
    await update(() => suggestion.resolve({ cuit: CUIT }));
    expect(receiver.choice).toBe('final');
  });

  it('el fallo del padron conserva las reglas actuales de confirmacion', async () => {
    mock.suggestion.mockResolvedValue({ cuit: CUIT });
    mock.lookup.mockRejectedValue(new Error('padron unavailable'));
    await render();
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(receiver.lookup.status).toBe('error');
    expect(receiver.ready).toBe(true);
    expect(receiver.cuitToSend).toBe(CUIT);
  });

  it('Pago acreditado incluye selector editable y bloquea el egreso mientras espera', async () => {
    const suggestion = deferred<{ cuit: string }>();
    mock.suggestion.mockReturnValue(suggestion.promise);
    await render({}, true);
    const button = [...container.querySelectorAll('button')].find(
      (item) => item.textContent === 'Confirmar egreso',
    )!;
    expect(button.disabled).toBe(true);
    const final = container.querySelector<HTMLButtonElement>('[role=radio]')!;
    await act(async () => {
      final.click();
      await Promise.resolve();
    });
    expect(button.disabled).toBe(false);
  });
});
