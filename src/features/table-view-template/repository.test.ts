// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localDb } from '../../lib/db/localDb';
import { enqueuePendingOp, setEnqueueUserId } from '../../lib/sync/enqueue';
import { syncService } from '../../lib/sync/SyncService';
import { TableViewConfigSchema } from './definitions';
import { saveTableTemplate } from './storage';
import {
  ensureTemplateScope,
  saveLocalTemplate,
  deleteLocalTemplate,
  readLocalTemplates,
  pullTemplateScope,
  pushTemplateOp,
} from './repository';
import {
  listTableTemplates,
  putTableTemplate,
  removeTableTemplate,
} from '../../lib/api/table-templates';

vi.mock('../../lib/api/table-templates', () => ({
  listTableTemplates: vi.fn(),
  putTableTemplate: vi.fn(),
  removeTableTemplate: vi.fn(),
}));
const scope = { userId: 'user-a', tenantId: 'tenant', tableKey: 'history' };
const input = {
  name: 'Diaria',
  config: TableViewConfigSchema.parse({
    globalSearchMode: 'ticket',
    globalSearch: '#66',
  }),
};
const dto = (id = 'id', name = 'Remota', deletedAt: string | null = null) => ({
  id,
  name,
  config: input.config,
  createdAt: '2026-11-03T00:00:00.000Z',
  updatedAt: '2026-11-03T00:01:00.000Z',
  deletedAt,
});
beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  setEnqueueUserId(scope.userId);
  await localDb.tableTemplates.clear();
  await localDb.tableTemplateScopes.clear();
  await localDb.pendingOps.clear();
  vi.mocked(listTableTemplates).mockResolvedValue([]);
});
describe('plantillas desktop local-first', () => {
  it('waits for an ongoing push before sending a newly saved template', async () => {
    await saveLocalTemplate(scope, input, 'id');
    let release!: (value: ReturnType<typeof dto>) => void;
    vi.mocked(putTableTemplate)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      )
      .mockImplementation((_s, _p, _b, id, body) =>
        Promise.resolve(dto(id, body.name)),
      );
    syncService.setCredentials(scope.tenantId, 'token-a', scope.userId);
    const first = syncService.pushPendingOps(false, 'tableTemplate');
    await vi.waitFor(() => expect(putTableTemplate).toHaveBeenCalledOnce());
    await saveLocalTemplate(scope, { ...input, name: 'Nueva' }, 'id');
    const second = syncService.pushPendingOps(false, 'tableTemplate');
    release(dto('id', 'Diaria'));
    await Promise.all([first, second]);
    expect((await readLocalTemplates(scope))[0].name).toBe('Nueva');
    expect(await localDb.pendingOps.count()).toBe(0);
  });
  it('stops publishing the old user pending ops when the session changes mid-push', async () => {
    await saveLocalTemplate(scope, input, 'first');
    await saveLocalTemplate(scope, input, 'second');
    let release!: (value: ReturnType<typeof dto>) => void;
    vi.mocked(putTableTemplate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    syncService.setCredentials(scope.tenantId, 'token-a', scope.userId);
    const pushing = syncService.pushPendingOps(false, 'tableTemplate');
    await vi.waitFor(() => expect(putTableTemplate).toHaveBeenCalledOnce());
    syncService.setCredentials(scope.tenantId, 'token-b', 'user-b');
    release(dto('first'));
    await pushing;
    expect(putTableTemplate).toHaveBeenCalledOnce();
    expect((await localDb.pendingOps.toArray())[0].entityId).toBe('second');
  });
  it('refreshing templates leaves operational pending ops untouched', async () => {
    await saveLocalTemplate(scope, input, 'id');
    await enqueuePendingOp({
      entityType: 'entry',
      entityId: 'entry-id',
      tenantId: scope.tenantId,
      payload: {},
      operation: 'update',
      status: 'pending',
    });
    syncService.setCredentials(scope.tenantId, 'token-a', scope.userId);
    vi.mocked(putTableTemplate).mockResolvedValue(dto());
    await syncService.pushPendingOps(false, 'tableTemplate');
    expect(
      (await localDb.pendingOps.toArray()).map((op) => op.entityType),
    ).toEqual(['entry']);
  });
  it('preserves same-device write order across retry backoff', async () => {
    await saveLocalTemplate(scope, input, 'id');
    const old = (await localDb.pendingOps.toArray())[0];
    await localDb.pendingOps.update(old.localId!, {
      nextAttemptAt: Date.now() + 60_000,
    });
    await saveLocalTemplate(scope, { ...input, name: 'Nueva' }, 'id');
    syncService.setCredentials(scope.tenantId, 'token-a', scope.userId);
    vi.mocked(putTableTemplate).mockImplementation((_s, _p, _b, id, body) =>
      Promise.resolve(dto(id, body.name)),
    );
    await syncService.pushPendingOps(false, 'tableTemplate');
    expect(putTableTemplate).not.toHaveBeenCalled();
    await syncService.pushPendingOps(true, 'tableTemplate');
    expect(
      vi.mocked(putTableTemplate).mock.calls.map((call) => call[4].name),
    ).toEqual(['Diaria', 'Nueva']);
    expect((await readLocalTemplates(scope))[0].name).toBe('Nueva');
  });
  it('imports legacy templates once, preserving ids and local selection', async () => {
    const legacy = saveTableTemplate(scope, input)!;
    await ensureTemplateScope(scope);
    await ensureTemplateScope(scope);
    expect((await readLocalTemplates(scope))[0].id).toBe(legacy.id);
    const ops = await localDb.pendingOps.toArray();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      userId: scope.userId,
      payload: { importing: true },
    });
    expect(putTableTemplate).not.toHaveBeenCalled();
  });
  it('saves offline, survives reopening IndexedDB and isolates users and tables', async () => {
    const saved = await saveLocalTemplate(scope, input);
    localDb.close();
    await localDb.open();
    expect((await readLocalTemplates(scope))[0].config.globalSearchMode).toBe(
      'ticket',
    );
    expect(await readLocalTemplates({ ...scope, userId: 'user-b' })).toEqual(
      [],
    );
    expect(await readLocalTemplates({ ...scope, tableKey: 'clients' })).toEqual(
      [],
    );
    expect(await readLocalTemplates({ ...scope, tenantId: 'other' })).toEqual(
      [],
    );
    expect(await localDb.pendingOps.count()).toBe(1);
    expect(saved.id).toBeTruthy();
    expect(putTableTemplate).not.toHaveBeenCalled();
  });
  it('does not publish personal pending ops under a different operator', async () => {
    await saveLocalTemplate(scope, input);
    syncService.setCredentials(scope.tenantId, 'token-b', 'user-b');
    await syncService.pushPendingOps();
    expect(putTableTemplate).not.toHaveBeenCalled();
    expect((await localDb.pendingOps.toArray())[0].status).toBe('pending');
    syncService.setCredentials(scope.tenantId, 'token-a', scope.userId);
    vi.mocked(putTableTemplate).mockImplementation((_s, _p, _b, id) =>
      Promise.resolve(dto(id)),
    );
    await syncService.pushPendingOps();
    expect(vi.mocked(putTableTemplate).mock.calls[0].slice(0, 3)).toEqual([
      scope,
      'desktop',
      'token-a',
    ]);
    expect(vi.mocked(putTableTemplate).mock.calls[0][4].mutationId).toEqual(
      expect.any(String),
    );
    expect(await localDb.pendingOps.count()).toBe(0);
  });
  it('pulls remote data without overwriting local edits or deletions still queued', async () => {
    await saveLocalTemplate(scope, input, 'dirty');
    vi.mocked(listTableTemplates).mockResolvedValue([
      dto('dirty'),
      dto('remote'),
    ]);
    await pullTemplateScope(scope, 'token');
    expect(
      (await readLocalTemplates(scope)).find((t) => t.id === 'dirty')?.name,
    ).toBe('Diaria');
    expect(
      (await readLocalTemplates(scope)).find((t) => t.id === 'remote')?.name,
    ).toBe('Remota');
    await deleteLocalTemplate(scope, 'remote');
    await pullTemplateScope(scope, 'token');
    expect(
      (await readLocalTemplates(scope)).find((t) => t.id === 'remote')
        ?.deletedAt,
    ).toBeTruthy();
  });
  it('retries a lost response using the same mutation id', async () => {
    await saveLocalTemplate(scope, input, 'id');
    const op = (await localDb.pendingOps.toArray())[0];
    vi.mocked(putTableTemplate)
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(dto());
    await expect(pushTemplateOp(op, scope.userId, 'token')).rejects.toThrow();
    expect(await localDb.pendingOps.count()).toBe(1);
    await pushTemplateOp(op, scope.userId, 'token');
    expect(vi.mocked(putTableTemplate).mock.calls[0][4].mutationId).toBe(
      vi.mocked(putTableTemplate).mock.calls[1][4].mutationId,
    );
    expect(await localDb.pendingOps.count()).toBe(0);
  });
  it('keeps a newer local edit when an older request completes', async () => {
    await saveLocalTemplate(scope, input, 'id');
    const op = (await localDb.pendingOps.toArray())[0];
    await saveLocalTemplate(scope, { ...input, name: 'Nueva' }, 'id');
    vi.mocked(putTableTemplate).mockResolvedValue(dto());
    await pushTemplateOp(op, scope.userId, 'token');
    expect((await readLocalTemplates(scope))[0].name).toBe('Nueva');
    expect(await localDb.pendingOps.count()).toBe(1);
  });
  it('syncs deletes and applies remote tombstones, without reimporting old storage', async () => {
    await saveLocalTemplate(scope, input, 'id');
    await localDb.pendingOps.clear();
    await deleteLocalTemplate(scope, 'id');
    vi.mocked(removeTableTemplate).mockResolvedValue(
      dto('id', 'Diaria', '2026-11-03T00:02:00.000Z'),
    );
    await pushTemplateOp(
      (await localDb.pendingOps.toArray())[0],
      scope.userId,
      'token',
    );
    await ensureTemplateScope(scope);
    expect((await readLocalTemplates(scope))[0].deletedAt).toBeTruthy();
    expect(await localDb.pendingOps.count()).toBe(0);
  });
});
