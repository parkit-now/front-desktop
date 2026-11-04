// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDb, type LocalClient } from '../../lib/db/localDb';
import {
  button,
  change,
  cleanup,
  click,
  field,
  mount,
  waitForText,
} from '../../test/dom';
import { ClientsPanel } from './ClientsPanel';

vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: false }),
}));
vi.mock('../../lib/sync/SyncContext', () => ({
  useSync: () => ({ triggerSync: vi.fn() }),
}));

function client(
  id: string,
  name: string,
  email: string,
  plate: string,
): LocalClient {
  return {
    id,
    name,
    email,
    plates: [plate],
    tenantId: 'tenant',
    cuit: null,
    phone: null,
    version: 1,
    syncSeq: 1,
    createdAt: '2026-11-04T10:00:00Z',
    updatedAt: '2026-11-04T10:00:00Z',
    deletedAt: null,
  };
}

beforeEach(async () => {
  localStorage.clear();
  await localDb.clients.bulkPut([
    client('name', 'Ana Pérez', 'otro@parkit.test', 'AB123CD'),
    client('email', 'Carla Gómez', 'ana@parkit.test', 'XY987ZZ'),
    {
      ...client('deleted', 'Ana eliminada', 'ana2@parkit.test', 'ZZ111ZZ'),
      deletedAt: '2026-11-04T11:00:00Z',
    },
  ]);
});
afterEach(async () => {
  await cleanup();
  localStorage.clear();
});

describe('búsqueda por campo de clientes offline', () => {
  it('separa Nombre y Email y conserva Todos como búsqueda inicial', async () => {
    const container = await mount(
      <ClientsPanel tenantId="tenant" userId="owner" accessToken="unused" />,
    );
    await waitForText('Ana Pérez');
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Todos');
    await change(field('Buscar en la tabla'), 'ana');
    const rows = () => container.querySelector('tbody')?.textContent;
    expect(rows()).toContain('Ana Pérez');
    expect(rows()).toContain('Carla Gómez');
    expect(rows()).not.toContain('Ana eliminada');
    await click('Campo de búsqueda');
    expect(
      [...container.querySelectorAll('[role="menuitemradio"]')].map(
        (item) => item.textContent,
      ),
    ).toEqual(['Todos', 'Patente', 'Nombre', 'CUIT', 'Email', 'Teléfono']);
    await click('Nombre');
    expect(rows()).toContain('Ana Pérez');
    expect(rows()).not.toContain('Carla Gómez');
    expect(field('Buscar en la tabla').value).toBe('ana');
    await click('Campo de búsqueda');
    await click('Email');
    expect(rows()).toContain('Carla Gómez');
    expect(rows()).not.toContain('Ana Pérez');
    await click('Limpiar búsqueda');
    expect(button('Campo de búsqueda').title).toBe('Buscar en: Email');
    expect(rows()).toContain('Ana Pérez');
    expect(rows()).toContain('Carla Gómez');
  });

  it('busca solo entre patentes sin coincidir con un email', async () => {
    await localDb.clients.update('email', { email: 'ab123@parkit.test' });
    const container = await mount(
      <ClientsPanel tenantId="tenant" userId="owner" accessToken="unused" />,
    );
    await waitForText('Ana Pérez');
    await click('Campo de búsqueda');
    await click('Patente');
    await change(field('Buscar en la tabla'), 'ab123');
    expect(container.querySelector('tbody')?.textContent).toContain(
      'Ana Pérez',
    );
    expect(container.querySelector('tbody')?.textContent).not.toContain(
      'Carla Gómez',
    );
  });
});
