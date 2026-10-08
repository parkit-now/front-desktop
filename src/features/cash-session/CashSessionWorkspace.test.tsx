// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CashSessionWorkspace } from './CashSessionWorkspace';
import { ToastProvider } from '../../lib/notifications/ToastProvider';
import { saveTableTemplate } from '../table-view-template';

vi.mock('./CashSessionPanel', () => ({
  CashSessionPanel: ({
    onViewMovements,
  }: {
    onViewMovements: (session: { id: string }) => void;
  }) => (
    <button onClick={() => onViewMovements({ id: 'active' })}>
      Ver caja activa
    </button>
  ),
}));
vi.mock('./CashSessionStats', async () => {
  const { useState } = await import('react');
  return {
    CashSessionStats: () => {
      const [draft, setDraft] = useState('');
      return (
        <div>
          <button onClick={() => setDraft('Nota sin guardar')}>
            Editar nota
          </button>
          <p>{draft}</p>
        </div>
      );
    },
  };
});
vi.mock('../../lib/sync/SyncContext', () => ({
  useSync: () => ({ triggerSync: vi.fn() }),
}));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: false }),
}));
vi.mock('../entries/useArcaEmitter', () => ({ useArcaEmitter: () => null }));
vi.mock('../entries/EntryEditDialog', async () => {
  const { useEscapeKey } = await import('../../lib/ui/useEscapeKey');
  return {
    EntryEditDialog: ({ onClose }: { onClose: () => void }) => {
      useEscapeKey(onClose);
      return (
        <div role="dialog" aria-label="Editar movimiento">
          <button onClick={onClose}>Cerrar detalle</button>
        </div>
      );
    },
  };
});
vi.mock('dexie-react-hooks', async () => {
  const { useState, useEffect, useRef } = await import('react');
  return {
    useLiveQuery: (query: () => Promise<unknown>) => {
      const [data, setData] = useState<unknown>();
      const queryRef = useRef(query);
      useEffect(() => {
        let active = true;
        void queryRef.current().then((result) => {
          if (active) setData(result);
        });
        return () => {
          active = false;
        };
      }, []);
      return data;
    },
  };
});
vi.mock('../../lib/db/localDb', () => {
  const date = '2026-10-07T10:00:00Z';
  const table = (records: Record<string, unknown>[]) => {
    const query = (rows: Record<string, unknown>[]) => ({
      toArray: () => Promise.resolve([...rows]),
      filter: (predicate: (row: Record<string, unknown>) => boolean) =>
        query(rows.filter(predicate)),
    });
    return {
      where: () => ({ equals: () => query(records) }),
      orderBy: () => ({
        keys: () => Promise.resolve(records.map((row) => row.cashSessionId)),
        filter: (predicate: (row: Record<string, unknown>) => boolean) => ({
          keys: () =>
            Promise.resolve(
              records.filter(predicate).map((row) => row.cashSessionId),
            ),
        }),
      }),
    };
  };
  return {
    localDb: {
      cashSessions: table([
        { id: 'active', tenantId: 'tenant', openedAt: date },
        {
          id: 'closed',
          tenantId: 'tenant',
          openedAt: '2026-10-06T10:00:00Z',
          closedAt: date,
        },
      ]),
      entries: table([
        {
          id: 'a',
          tenantId: 'tenant',
          plate: 'ACT123',
          cashSessionId: 'active',
          enteredAt: date,
          updatedAt: date,
        },
        {
          id: 'b',
          tenantId: 'tenant',
          plate: 'OLD123',
          cashSessionId: 'closed',
          enteredAt: date,
          leftAt: date,
          amountPaid: '10',
          updatedAt: date,
        },
      ]),
      paymentTransactions: table([]),
      pendingOps: table([]),
      invoices: table([]),
      lprDetectionEvents: table([]),
    },
  };
});

let root: Root;
let container: HTMLDivElement;
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text,
  )!;
  expect(button).toBeTruthy();
  await act(() => Promise.resolve(button.click()));
}
async function openClosed() {
  await act(() =>
    Promise.resolve(
      container
        .querySelector<HTMLTableRowElement>('.cash-session-history tbody tr')!
        .click(),
    ),
  );
  await click('Ver movimientos');
}
function historyRows() {
  return [
    ...container.querySelectorAll('.cash-session-movements-dialog tbody tr'),
  ].map((row) => row.textContent);
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => Promise.resolve(root.unmount()));
  container.remove();
  localStorage.clear();
});
async function render(operator = false) {
  await act(() =>
    Promise.resolve(
      root.render(
        <ToastProvider>
          <CashSessionWorkspace
            tenantId="tenant"
            userId="user"
            accessToken="token"
            actorRole={operator ? 'operator' : 'owner'}
            canViewHistory={!operator}
          />
        </ToastProvider>,
      ),
    ),
  );
}

describe('movimientos de caja en un dialogo', () => {
  it('abre las cajas activa y cerrada con sus filas, sin desmontar Caja', async () => {
    await render();
    await click('Ver caja activa');
    expect(historyRows()).toHaveLength(1);
    expect(historyRows()[0]).toContain('ACT123');
    expect(container.textContent).toContain('Historial de cajas');
    await act(() =>
      Promise.resolve(
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Cerrar movimientos"]',
          )!
          .click(),
      ),
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await openClosed();
    expect(historyRows()).toHaveLength(1);
    expect(historyRows()[0]).toContain('OLD123');
    expect(container.querySelector('button[title*="Excel"]')).toBeTruthy();
  });
  it('no deja que una plantilla anterior cambie la caja pedida', async () => {
    saveTableTemplate(
      {
        userId: 'user',
        tenantId: 'tenant',
        tableKey: 'cash-session-movements',
      },
      {
        name: 'Caja activa',
        config: {
          version: 1,
          columns: { visibility: {}, order: [], pinnedLeft: [] },
          filters: [{ id: 'cashSessionId', value: ['active'] }],
          globalSearch: 'ACT123',
          sorting: [],
          pagination: { pageSize: 20 },
        },
      },
    );
    await render();
    await openClosed();
    expect(historyRows()).toHaveLength(1);
    expect(historyRows()[0]).toContain('OLD123');
    expect(
      [...Array(localStorage.length).keys()]
        .map((index) => localStorage.key(index))
        .join(),
    ).not.toContain('entry-history');
  });
  it('Escape cierra el detalle primero y conserva el historial debajo', async () => {
    await render();
    await openClosed();
    await act(() =>
      Promise.resolve(
        container
          .querySelector<HTMLTableRowElement>(
            '.cash-session-movements-dialog tbody tr',
          )!
          .click(),
      ),
    );
    expect(
      container.querySelector('[aria-label="Editar movimiento"]'),
    ).toBeTruthy();
    await act(() =>
      Promise.resolve(
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      ),
    );
    expect(
      container.querySelector('[aria-label="Editar movimiento"]'),
    ).toBeNull();
    expect(
      container.querySelector('.cash-session-movements-dialog'),
    ).toBeTruthy();
    await act(() =>
      Promise.resolve(
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      ),
    );
    expect(
      container.querySelector('.cash-session-movements-dialog'),
    ).toBeNull();
  });
  it('mantiene al operador limitado a la caja actual', async () => {
    await render(true);
    expect(container.textContent).not.toContain('Historial de cajas');
    await click('Ver caja activa');
    expect(historyRows()).toHaveLength(1);
    expect(historyRows()[0]).toContain('ACT123');
  });
  it('conserva el detalle y su borrador al cerrar movimientos con el boton o Escape', async () => {
    await render();
    await openClosed();
    const detail = container.querySelector('.cash-session-detail-dialog')!;
    expect(detail.closest('[inert]')).toBeTruthy();
    await act(() =>
      Promise.resolve(
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Cerrar movimientos"]',
          )!
          .click(),
      ),
    );
    expect(container.querySelector('.cash-session-detail-dialog')).toBe(detail);
    expect(detail.closest('[inert]')).toBeNull();
    await click('Editar nota');
    await click('Ver movimientos');
    await act(() =>
      Promise.resolve(
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      ),
    );
    expect(
      container.querySelector('.cash-session-movements-dialog'),
    ).toBeNull();
    expect(container.querySelector('.cash-session-detail-dialog')).toBe(detail);
    expect(detail.textContent).toContain('Nota sin guardar');
    await act(() =>
      Promise.resolve(
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      ),
    );
    expect(container.querySelector('.cash-session-detail-dialog')).toBeNull();
  });
});
