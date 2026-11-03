import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listTableTemplates,
  putTableTemplate,
  removeTableTemplate,
} from './table-templates';

const scope = {
  userId: 'private-user',
  tenantId: 'parking',
  tableKey: 'history',
};
function mockFetch() {
  const fetcher = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response('[]', { status: 200 })),
  );
  vi.stubGlobal('fetch', fetcher);
  vi.stubEnv('VITE_API_URL', 'http://templates.test');
  return fetcher;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('table template HTTP client', () => {
  it('encodes context, platform and table without accepting a user id from the request', async () => {
    const fetcher = mockFetch();
    await listTableTemplates(scope, 'desktop', 'token');
    expect(fetcher.mock.calls[0][0]).toBe(
      'http://templates.test/tenants/parking/table-templates?platform=desktop&tableKey=history',
    );
    await listTableTemplates({ ...scope, tenantId: 'admin' }, 'web', 'token');
    expect(fetcher.mock.calls[1][0]).toBe(
      'http://templates.test/admin/table-templates?platform=web&tableKey=history',
    );
  });
  it('sends only DTO fields when the cached template contains local or response metadata', async () => {
    const fetcher = mockFetch();
    const body = {
      mutationId: 'mutation',
      name: 'Diaria',
      description: 'Trabajo',
      config: { version: 1 },
      id: 'legacy',
      createdAt: '2026-11-03T00:00:00Z',
      updatedAt: 'now',
      userId: 'ignored',
      key: 'local-key',
    };
    await putTableTemplate(scope, 'desktop', 'token', 'legacy', body);
    const options = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string)).toEqual({
      mutationId: 'mutation',
      name: 'Diaria',
      description: 'Trabajo',
      config: { version: 1 },
    });
    await putTableTemplate(scope, 'desktop', 'token', 'legacy', body, true);
    expect((fetcher.mock.calls[1][1] as RequestInit).body as string).toContain(
      'createdAt',
    );
    await removeTableTemplate(scope, 'desktop', 'token', 'legacy', 'delete-id');
    expect(
      JSON.parse((fetcher.mock.calls[2][1] as RequestInit).body as string),
    ).toEqual({ mutationId: 'delete-id' });
  });
});
