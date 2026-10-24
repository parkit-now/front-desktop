// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDb, type LocalEntry } from '../../lib/db/localDb';
import {
  change,
  cleanup,
  click,
  field,
  mount,
  pageText,
  waitForText,
} from '../../test/dom';
import { ExitControls } from './ExitControls';

// El cobro tiene sus propios tests: acá importa qué ingreso se abre.
vi.mock('./ExitModal', () => ({
  ExitModal: ({ entry }: { entry: LocalEntry }) => (
    <section data-exit={entry.id}>{`cobro:${entry.plate}`}</section>
  ),
}));

const NOW = new Date().toISOString();

function entry(overrides: Partial<LocalEntry> = {}): LocalEntry {
  return {
    id: 'e-1',
    tenantId: 'tenant',
    plate: 'AB123CD',
    enteredAt: NOW,
    ticketNumber: 3,
    vehicleBrand: 'Volkswagen',
    vehicleModel: 'Bora',
    rateSnapshotName: 'DIA AUTO',
    cashSessionId: 'caja-1',
    version: 1,
    syncSeq: 1,
    updatedAt: NOW,
    ...overrides,
  };
}

function render(actorRole: 'owner' | 'operator' = 'operator') {
  return mount(
    <ExitControls
      tenantId="tenant"
      accessToken="token"
      userId="user"
      actorRole={actorRole}
      parkingName="APEX"
    />,
  );
}

describe('ExitControls', () => {
  beforeEach(async () => {
    await localDb.entries.bulkPut([
      entry(),
      entry({ id: 'e-2', plate: 'XYZ999', ticketNumber: 4 }),
      entry({ id: 'salio', plate: 'OLD123', ticketNumber: 1, leftAt: NOW }),
    ]);
    await localDb.cashSessions.put({
      id: 'caja-1',
      tenantId: 'tenant',
      openedAt: NOW,
      openingCash: 0,
    } as never);
  });

  afterEach(async () => {
    await cleanup();
  });

  it('cobra por número de ticket', async () => {
    await render();

    await change(field('N° de ticket (ej. 3)'), '4');
    await click('Cobrar');

    expect(document.querySelector('[data-exit="e-2"]')).toBeTruthy();
  });

  it('avisa si no hay un auto activo con ese ticket', async () => {
    await render();

    await change(field('N° de ticket (ej. 3)'), '1');
    await click('Cobrar');

    await waitForText('No hay ningún auto activo con el ticket #1.');
  });

  it('lista los autos en base y abre el egreso de uno', async () => {
    await render();

    await waitForText('Ver autos en base2');
    await click(/^Ver autos en base/);
    await waitForText('XYZ999');
    expect(pageText()).not.toContain('OLD123');

    const row = [...document.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('AB123CD'),
    )!;
    await click(
      [...row.querySelectorAll<HTMLElement>('button')].find(
        (b) => b.textContent?.trim() === 'Egreso',
      )!,
    );

    expect(document.querySelector('[data-exit="e-1"]')).toBeTruthy();
    expect(pageText()).not.toContain('Autos en base');
  });

  it('el dueño ve la acción de borrar y se cierra con la cruz', async () => {
    await render('owner');

    await click(/^Ver autos en base/);
    await waitForText('XYZ999');
    expect(
      document.querySelector('[aria-label*="Eliminar"], [title*="liminar"]'),
    ).toBeTruthy();

    await click('Cerrar');
    expect(pageText()).not.toContain('Autos en base');
  });
});
