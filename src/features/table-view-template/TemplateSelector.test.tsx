// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mount,
  cleanup,
  click,
  change,
  field,
  settle,
  button,
} from '../../test/dom';
import { TemplateSelector } from './TemplateSelector';
import { TableViewConfigSchema } from './definitions';
import { localDb } from '../../lib/db/localDb';
import { setEnqueueUserId } from '../../lib/sync/enqueue';
import { listTableTemplates } from '../../lib/api/table-templates';

const network = vi.hoisted(() => ({ isOnline: false }));
vi.mock('../../lib/network/NetworkContext', () => ({
  useNetwork: () => network,
}));
vi.mock('../../lib/api/table-templates', () => ({
  listTableTemplates: vi.fn().mockResolvedValue([]),
  putTableTemplate: vi.fn(),
  removeTableTemplate: vi.fn(),
}));
vi.mock('../../lib/supabase/session', () => ({
  getSession: () =>
    Promise.resolve({ access_token: 'token', user: { id: 'user' } }),
}));
const scope = { userId: 'user', tenantId: 'tenant', tableKey: 'history' };
const config = TableViewConfigSchema.parse({
  globalSearch: '#66',
  globalSearchMode: 'ticket',
});
const onApply = vi.fn();
function Harness() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <TemplateSelector
      scope={scope}
      selectedTemplateId={selected}
      onSelectedTemplateIdChange={setSelected}
      getCurrentConfig={() => config}
      onApply={onApply}
    />
  );
}
beforeEach(async () => {
  localStorage.clear();
  network.isOnline = false;
  onApply.mockClear();
  setEnqueueUserId(scope.userId);
  await localDb.tableTemplates.clear();
  await localDb.tableTemplateScopes.clear();
  await localDb.pendingOps.clear();
});
afterEach(cleanup);
describe('selector desktop sincronizable', () => {
  it('saves and applies a template offline through the actual UI and Dexie', async () => {
    await mount(<Harness />);
    await click('Plantillas');
    expect((button('Guardar plantilla') as HTMLButtonElement).disabled).toBe(
      false,
    );
    await click('Guardar plantilla');
    await change(field('Nombre'), 'Trabajo offline');
    await click('Guardar');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(await localDb.tableTemplates.count()).toBe(1);
    expect((await localDb.pendingOps.toArray())[0].userId).toBe('user');
    await click('Plantillas');
    await click('Trabajo offline');
    expect(onApply).toHaveBeenCalledWith(config);
  });
  it('refreshes available templates on focus without applying them to the current view', async () => {
    network.isOnline = true;
    await mount(<Harness />);
    vi.mocked(listTableTemplates).mockResolvedValueOnce([
      {
        id: 'remote',
        name: 'Desde otra PC',
        config,
        createdAt: '2026-11-03T00:00:00.000Z',
        updatedAt: '2026-11-03T00:00:00.000Z',
        deletedAt: null,
      },
    ]);
    await act(() => {
      window.dispatchEvent(new Event('focus'));
      return Promise.resolve();
    });
    await settle();
    expect(await localDb.tableTemplates.count()).toBe(1);
    expect(onApply).not.toHaveBeenCalled();
  });
});
