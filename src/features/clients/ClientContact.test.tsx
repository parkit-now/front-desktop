// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientContact } from './ClientContact';

const mock = vi.hoisted(() => ({ copy: vi.fn(), toast: vi.fn() }));
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => [
    {
      plates: ['AB123CD'],
      cuit: '30000000007',
      name: 'Juan Pedro',
      email: 'juan@example.com',
      phone: '1541515',
      deletedAt: null,
    },
  ],
}));
vi.mock('../../lib/db/localDb', () => ({ localDb: {} }));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: mock.toast }),
}));

let root: Root;
let container: HTMLDivElement;
let previousDesktop: PropertyDescriptor | undefined;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mock.copy.mockResolvedValue({ ok: true });
  previousDesktop = Object.getOwnPropertyDescriptor(window, 'parkitDesktop');
  Object.defineProperty(window, 'parkitDesktop', {
    configurable: true,
    value: { copyText: mock.copy },
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<ClientContact tenantId="tenant" plate="AB123CD" />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (previousDesktop)
    Object.defineProperty(window, 'parkitDesktop', previousDesktop);
  else Reflect.deleteProperty(window, 'parkitDesktop');
});

describe('contacto del cliente en desktop', () => {
  it('copia email y teléfono con el portapapeles de Electron', async () => {
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Copiar email"]')!
        .click();
      await Promise.resolve();
    });
    expect(mock.copy).toHaveBeenCalledWith('juan@example.com');
    expect(mock.toast).toHaveBeenCalledWith({
      message: 'Email copiado.',
      kind: 'success',
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Copiar teléfono"]')!
        .click();
      await Promise.resolve();
    });
    expect(mock.copy).toHaveBeenCalledWith('1541515');
  });

  it('avisa cuando Electron no pudo copiar', async () => {
    mock.copy.mockResolvedValue({ ok: false });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Copiar email"]')!
        .click();
      await Promise.resolve();
    });
    expect(mock.toast).toHaveBeenCalledWith({
      message: 'No se pudo copiar email.',
      kind: 'error',
    });
  });
});
