// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localDb } from '../../lib/db/localDb';
import { change, cleanup, field, mount, waitForText } from '../../test/dom';
import { CashSessionHistoryPanel } from './CashSessionHistoryPanel';

beforeEach(async () => {
  localStorage.clear();
  await localDb.cashSessions.bulkPut([
    {
      id: 'caja-nota',
      tenantId: 'tenant',
      openedAt: '2026-11-03T10:00:00Z',
      closedAt: '2026-11-03T20:00:00Z',
      openingCash: 4500,
      notes: 'Revisar fondo 98765',
      version: 1,
      syncSeq: 1,
      updatedAt: '2026-11-03T20:00:00Z',
    },
    {
      id: 'caja-importe',
      tenantId: 'tenant',
      openedAt: '2026-11-02T10:00:00Z',
      closedAt: '2026-11-02T20:00:00Z',
      openingCash: 98765,
      leavingCash: 87654,
      notes: 'Turno sin novedades',
      version: 1,
      syncSeq: 2,
      updatedAt: '2026-11-02T20:00:00Z',
    },
  ]);
});

afterEach(async () => {
  await cleanup();
  localStorage.clear();
});

describe('búsqueda del historial de cajas', () => {
  it('busca solo en notas sin ofrecer selector de campos', async () => {
    const container = await mount(
      <CashSessionHistoryPanel tenantId="tenant" accessToken="token" />,
    );
    await waitForText('Turno sin novedades');
    const rows = () => [...container.querySelectorAll('tbody tr')];
    expect(rows()).toHaveLength(2);
    expect(
      container.querySelector('[aria-label="Campo de búsqueda"]'),
    ).toBeNull();

    const search = field('Buscar por notas', container);
    await change(search, 'REVISAR');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Revisar fondo');

    await change(search, '98765');
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Revisar fondo');

    for (const query of ['4500', '87654', '2026-11']) {
      await change(search, query);
      expect(container.textContent).toContain('Mostrando 0 a 0 de 0');
    }

    await change(search, '');
    expect(rows()).toHaveLength(2);
  });
});
