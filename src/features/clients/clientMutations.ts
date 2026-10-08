import { ApiError } from '../../lib/api/client';
import {
  createClient,
  deleteClient,
  updateClient,
  type CreateClientDto,
  type UpdateClientDto,
} from '../../lib/api/clients';
import { localDb, type LocalClient } from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { generateUuidV7 } from '../entries/entryUtils';

type Input = {
  tenantId: string;
  bearer: string;
  isOnline: boolean;
  row?: LocalClient;
  body?: UpdateClientDto;
  remove?: boolean;
};

async function projectMovedPlates(
  tenantId: string,
  destinationId: string,
  plates: string[],
) {
  const others = await localDb.clients
    .where('tenantId')
    .equals(tenantId)
    .filter(
      (row) =>
        row.id !== destinationId &&
        !row.deletedAt &&
        row.plates.some((plate) => plates.includes(plate)),
    )
    .toArray();
  for (const row of others) {
    const remaining = row.plates.filter((plate) => !plates.includes(plate));
    if (remaining.length)
      await localDb.clients.update(row.id, { plates: remaining });
    else await localDb.clients.delete(row.id);
  }
}

export async function mutateClient(input: Input): Promise<void> {
  const id = input.row?.id ?? generateUuidV7();
  const operation = input.remove ? 'delete' : input.row ? 'update' : 'create';
  const body = input.body ?? {};
  const queued = await localDb.pendingOps
    .where('entityType')
    .equals('client')
    .filter((op) => op.tenantId === input.tenantId && op.entityId === id)
    .toArray();
  if (input.isOnline && queued.length === 0) {
    try {
      const credentials = { tenantId: input.tenantId, bearer: input.bearer };
      const row =
        operation === 'create'
          ? await createClient({
              ...credentials,
              body: { ...body, id } as CreateClientDto,
            })
          : operation === 'delete'
            ? await deleteClient({
                ...credentials,
                id,
                expectedVersion: input.row!.version,
              })
            : await updateClient({
                ...credentials,
                id,
                expectedVersion: input.row!.version,
                body,
              });
      await localDb.transaction('rw', localDb.clients, async () => {
        if (row.deletedAt) await localDb.clients.delete(id);
        else {
          await localDb.clients.put(row);
          if (body.movePlates)
            await projectMovedPlates(input.tenantId, id, row.plates);
        }
      });
      return;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status < 500 &&
        error.status !== 408 &&
        error.status !== 429
      )
        throw error;
    }
  }

  await localDb.transaction(
    'rw',
    localDb.clients,
    localDb.pendingOps,
    async () => {
      const pending = await localDb.pendingOps
        .where('entityType')
        .equals('client')
        .filter((op) => op.tenantId === input.tenantId && op.entityId === id)
        .toArray();
      if (
        pending.some((op) => op.status === 'conflict' || op.status === 'failed')
      ) {
        throw new ApiError(409, 'Unresolved client operation', null);
      }
      const editable = pending.find(
        (op) => op.status === 'pending' && op.operation !== 'delete',
      );
      if (operation === 'delete' && editable?.operation === 'create') {
        await localDb.pendingOps.delete(editable.localId!);
        await localDb.clients.delete(id);
        return;
      }
      const now = new Date().toISOString();
      const next: LocalClient = {
        id,
        tenantId: input.tenantId,
        plates: [],
        cuit: null,
        name: null,
        email: null,
        phone: null,
        version: 1,
        syncSeq: 0,
        createdAt: now,
        deletedAt: null,
        ...input.row,
        ...body,
        updatedAt: now,
      };
      if (input.remove) next.deletedAt = now;
      else if (input.row) next.version = input.row.version + 1;
      if (editable) {
        const previous = editable.payload as {
          expectedVersion: number;
          body: UpdateClientDto;
        };
        next.version =
          editable.operation === 'create' ? 1 : previous.expectedVersion + 1;
        const payload =
          operation === 'delete'
            ? { expectedVersion: previous.expectedVersion }
            : editable.operation === 'create'
              ? { ...(editable.payload as CreateClientDto), ...body }
              : {
                  expectedVersion: previous.expectedVersion,
                  body: { ...previous.body, ...body },
                };
        await localDb.pendingOps.update(editable.localId!, {
          operation: operation === 'delete' ? 'delete' : editable.operation,
          payload,
          error: undefined,
          retryCount: 0,
          nextAttemptAt: undefined,
        });
      } else {
        await enqueuePendingOp({
          entityType: 'client',
          operation,
          tenantId: input.tenantId,
          entityId: id,
          status: 'pending',
          payload:
            operation === 'create'
              ? { ...body, id }
              : operation === 'delete'
                ? { expectedVersion: input.row!.version }
                : { expectedVersion: input.row!.version, body },
        });
      }
      await localDb.clients.put(next);
      if (body.movePlates && !input.remove)
        await projectMovedPlates(input.tenantId, id, next.plates);
    },
  );
}
