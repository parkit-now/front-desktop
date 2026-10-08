// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArcaEmitterState } from './useArcaEmitter';

const mock = vi.hoisted(() => ({ account: vi.fn() }));
vi.mock('../../lib/api/arca', () => ({ getArcaAccount: mock.account }));

let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useArcaEmitterState>;

function Harness() {
  state = useArcaEmitterState('tenant', 'token', true);
  return null;
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  mock.account.mockReset();
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
  vi.useRealTimers();
});

describe('useArcaEmitterState', () => {
  it('no declara lista la configuracion hasta que responde ARCA', async () => {
    let resolve!: (value: unknown) => void;
    mock.account.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await act(() => Promise.resolve(root.render(<Harness />)));
    expect(state.status).toBe('loading');

    await act(async () => {
      resolve({ status: 'linked', condicionIva: 'monotributo' });
      await Promise.resolve();
    });
    expect(state.status).toBe('ready');
    expect(state.emitter?.condicionIva).toBe('monotributo');
  });

  it('libera la espera a los cinco segundos y descarta una respuesta tardia', async () => {
    let resolve!: (value: unknown) => void;
    mock.account.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await act(() => Promise.resolve(root.render(<Harness />)));
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(state.status).toBe('error');
    expect(state.emitter).toBeNull();

    await act(async () => {
      resolve({ status: 'linked', condicionIva: 'monotributo' });
      await Promise.resolve();
    });
    expect(state.status).toBe('error');
    expect(state.emitter).toBeNull();
  });
});
