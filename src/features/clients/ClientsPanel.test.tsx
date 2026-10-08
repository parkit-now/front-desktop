// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientsPanel } from './ClientsPanel';

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => [] }));
vi.mock('../../lib/db/localDb', () => ({ localDb: {} }));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
}));
vi.mock('../../lib/sync/SyncContext', () => ({
  useSync: () => ({ triggerSync: vi.fn() }),
}));
vi.mock('../../lib/notifications/ToastProvider', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../data-table', () => ({
  DataTable: ({ headerAction }: { headerAction: ReactNode }) => (
    <div>{headerAction}</div>
  ),
}));
vi.mock('../../lib/ui/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <ClientsPanel tenantId="tenant" accessToken="token" userId="owner" />,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('diálogo de clientes', () => {
  it('cierra con el fondo o con la cruz, sin botón Cancelar', () => {
    const open = () =>
      Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.trim() === 'Agregar cliente',
      )!;

    act(() => open().click());
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Cancelar');

    act(() => {
      container
        .querySelector('.rate-dialog-backdrop')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    act(() => open().click());
    act(() => {
      container
        .querySelector('.clients-dialog')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Cerrar"]')!
        .click(),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
