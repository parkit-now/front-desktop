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
vi.mock('../data-table', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data-table')>()),
  DataTable: ({
    title,
    headerTabs,
    headerAction,
  }: {
    title?: string;
    headerTabs?: ReactNode;
    headerAction: ReactNode;
  }) => (
    <section className="dt-card">
      <div className="dt-card-header">
        <div>
          <h3>{title}</h3>
          {headerTabs}
        </div>
        <div className="dt-card-header-right">{headerAction}</div>
      </div>
    </section>
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
  it('separa Facturación de Vehículos y permite cambiar con teclado', () => {
    const tabs = () =>
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs()[0].textContent).toBe('Facturación');
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    act(() => tabs()[1].click());
    expect(tabs()[1].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[1]);
    expect(container.textContent).toContain('Agregar vehículo');
    expect(container.textContent).not.toContain('Agregar cliente');
    tabs()[0].focus();
    act(() => {
      tabs()[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs()[1]);
    act(() => {
      tabs()[1].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true }),
      );
    });
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[0]);
    expect(container.textContent).toContain('Agregar cliente');
  });
  it('mantiene el título, las pestañas y el alta dentro de la cabecera en ambas vistas', () => {
    for (const label of ['Vehículos', 'Facturación']) {
      const tab = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ).find((button) => button.textContent === label)!;
      act(() => tab.click());
      const header = container.querySelector('.dt-card-header')!;
      expect(header.querySelector('h3')?.textContent).toBe('Clientes');
      expect(header.querySelector('[role="tablist"]')).not.toBeNull();
      expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);
      expect(
        header.querySelector('.dt-card-header-right')?.textContent,
      ).toContain(
        label === 'Vehículos' ? 'Agregar vehículo' : 'Agregar cliente',
      );
    }
  });
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
