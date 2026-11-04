import {
  localDb,
  type LocalTableTemplate,
  type PendingOp,
} from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import {
  listTableTemplates,
  putTableTemplate,
  removeTableTemplate,
  type SavedTableTemplateDto,
} from '../../lib/api/table-templates';
import {
  TableViewTemplateSchema,
  type TableTemplateScope,
  type SaveTableTemplateInput,
} from './definitions';
import { readTableTemplateCollection } from './storage';

export const templateScopeKey = (scope: TableTemplateScope) =>
  JSON.stringify([scope.userId, scope.tenantId, scope.tableKey]);
const rowKey = (scope: TableTemplateScope, id: string) =>
  JSON.stringify([scope.userId, scope.tenantId, scope.tableKey, id]);
const uuid = () => crypto.randomUUID();
type TemplateOp = {
  scope: TableTemplateScope;
  mutationId: string;
  importing?: boolean;
  template?: SaveTableTemplateInput & { createdAt?: string };
};

export function readLocalTemplates(scope: TableTemplateScope) {
  return localDb.tableTemplates
    .where('[userId+tenantId+tableKey]')
    .equals([scope.userId, scope.tenantId, scope.tableKey])
    .toArray();
}
export async function ensureTemplateScope(
  scope: TableTemplateScope,
): Promise<void> {
  await localDb.transaction(
    'rw',
    [localDb.tableTemplateScopes, localDb.tableTemplates, localDb.pendingOps],
    async () => {
      const key = templateScopeKey(scope);
      if (await localDb.tableTemplateScopes.get(key)) return;
      const legacy = readTableTemplateCollection(scope).templates;
      for (const template of legacy) {
        const key = rowKey(scope, template.id);
        await localDb.tableTemplates.put({ ...scope, ...template, key });
        await enqueuePendingOp(
          {
            entityType: 'tableTemplate',
            entityId: template.id,
            tenantId: scope.tenantId,
            operation: 'create',
            status: 'pending',
            payload: {
              scope,
              importing: true,
              mutationId: uuid(),
              template,
            } satisfies TemplateOp,
          },
          scope.userId,
        );
      }
      await localDb.tableTemplateScopes.put({ ...scope, key });
    },
  );
}
export async function saveLocalTemplate(
  scope: TableTemplateScope,
  input: SaveTableTemplateInput,
  id: string = uuid(),
): Promise<LocalTableTemplate> {
  await ensureTemplateScope(scope);
  return localDb.transaction(
    'rw',
    [localDb.tableTemplates, localDb.pendingOps],
    async () => {
      const key = rowKey(scope, id);
      const existing = await localDb.tableTemplates.get(key);
      const now = new Date().toISOString();
      const template = TableViewTemplateSchema.parse({
        id,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        config: input.config,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      const row = { ...scope, ...template, key, deletedAt: null };
      await localDb.tableTemplates.put(row);
      await enqueuePendingOp(
        {
          entityType: 'tableTemplate',
          entityId: id,
          tenantId: scope.tenantId,
          operation: 'update',
          status: 'pending',
          payload: { scope, mutationId: uuid(), template } satisfies TemplateOp,
        },
        scope.userId,
      );
      return row;
    },
  );
}
export async function deleteLocalTemplate(
  scope: TableTemplateScope,
  id: string,
): Promise<void> {
  await localDb.transaction(
    'rw',
    [localDb.tableTemplates, localDb.pendingOps],
    async () => {
      await localDb.tableTemplates.update(rowKey(scope, id), {
        deletedAt: new Date().toISOString(),
      });
      await enqueuePendingOp(
        {
          entityType: 'tableTemplate',
          entityId: id,
          tenantId: scope.tenantId,
          operation: 'delete',
          status: 'pending',
          payload: { scope, mutationId: uuid() } satisfies TemplateOp,
        },
        scope.userId,
      );
    },
  );
}
function fromServer(
  scope: TableTemplateScope,
  dto: SavedTableTemplateDto,
): LocalTableTemplate {
  // Deleted records intentionally have no valid view config.
  const parsed = dto.deletedAt
    ? {
        ...dto,
        config: {
          version: 1 as const,
          columns: { visibility: {}, order: [], pinnedLeft: [] },
          filters: [],
          sorting: [],
          globalSearch: '',
          pagination: { pageSize: 10 },
        },
      }
    : TableViewTemplateSchema.parse(dto);
  return {
    ...scope,
    ...parsed,
    description: dto.description ?? undefined,
    deletedAt: dto.deletedAt,
    key: rowKey(scope, dto.id),
  };
}
async function dirtyIds(scope: TableTemplateScope): Promise<Set<string>> {
  const ops = await localDb.pendingOps
    .where('entityType')
    .equals('tableTemplate')
    .toArray();
  return new Set(
    ops
      .filter(
        (op) =>
          op.userId === scope.userId &&
          (op.payload as TemplateOp).scope.tenantId === scope.tenantId &&
          (op.payload as TemplateOp).scope.tableKey === scope.tableKey,
      )
      .map((op) => op.entityId),
  );
}
export async function pullTemplateScope(
  scope: TableTemplateScope,
  bearer: string,
): Promise<void> {
  const rows = await listTableTemplates(scope, 'desktop', bearer);
  await localDb.transaction(
    'rw',
    [localDb.tableTemplates, localDb.pendingOps],
    async () => {
      const dirty = await dirtyIds(scope);
      for (const dto of rows) {
        if (!dirty.has(dto.id))
          await localDb.tableTemplates.put(fromServer(scope, dto));
      }
    },
  );
}
export async function pushTemplateOp(
  op: PendingOp,
  userId: string,
  bearer: string,
): Promise<void> {
  const payload = op.payload as TemplateOp;
  if (!userId || op.userId !== userId || payload.scope.userId !== userId)
    return;
  const dto =
    op.operation === 'delete'
      ? await removeTableTemplate(
          payload.scope,
          'desktop',
          bearer,
          op.entityId,
          payload.mutationId,
        )
      : await putTableTemplate(
          payload.scope,
          'desktop',
          bearer,
          op.entityId,
          {
            ...payload.template!,
            config: payload.template!.config,
            mutationId: payload.mutationId,
          },
          payload.importing,
        );
  await localDb.transaction(
    'rw',
    [localDb.tableTemplates, localDb.pendingOps],
    async () => {
      await localDb.pendingOps.delete(op.localId!);
      const dirty = await dirtyIds(payload.scope);
      if (!dirty.has(op.entityId))
        await localDb.tableTemplates.put(fromServer(payload.scope, dto));
    },
  );
}

export async function hasEarlierTemplateOp(op: PendingOp): Promise<boolean> {
  const scope = (op.payload as TemplateOp).scope;
  const earlier = await localDb.pendingOps
    .where('entityType')
    .equals('tableTemplate')
    .filter(
      (other) =>
        other.userId === op.userId &&
        other.entityId === op.entityId &&
        other.localId! < op.localId! &&
        ['pending', 'in-flight', 'unreviewed'].includes(other.status) &&
        templateScopeKey((other.payload as TemplateOp).scope) ===
          templateScopeKey(scope),
    )
    .first();
  return earlier !== undefined;
}
