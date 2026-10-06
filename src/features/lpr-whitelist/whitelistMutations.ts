import { ApiError } from '../../lib/api/client';
import {
  createLprIgnoredPlate,
  deleteLprIgnoredPlate,
  updateLprIgnoredPlate,
  type CreateLprIgnoredPlateDto,
  type UpdateLprIgnoredPlateDto,
} from '../../lib/api/lpr-ignored-plates';
import { localDb, type LocalLprIgnoredPlate } from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { generateUuidV7 } from '../entries/entryUtils';

type Input = {
  tenantId: string;
  bearer: string;
  isOnline: boolean;
  row?: LocalLprIgnoredPlate;
  body?: UpdateLprIgnoredPlateDto;
  remove?: boolean;
};

export async function mutateWhitelist(input: Input): Promise<void> {
  const id = input.row?.id ?? generateUuidV7();
  const operation = input.remove ? 'delete' : input.row ? 'update' : 'create';
  const body = input.body ?? {};
  const queued = await localDb.pendingOps
    .where('entityType')
    .equals('lprIgnoredPlate')
    .filter((op) => op.tenantId === input.tenantId && op.entityId === id)
    .toArray();
  if (input.isOnline && queued.length === 0) {
    try {
      const credentials = { tenantId: input.tenantId, bearer: input.bearer };
      const row =
        operation === 'create'
          ? await createLprIgnoredPlate({
              ...credentials,
              body: { ...body, id } as CreateLprIgnoredPlateDto,
            })
          : operation === 'delete'
            ? await deleteLprIgnoredPlate({
                ...credentials,
                id,
                expectedVersion: input.row!.version,
              })
            : await updateLprIgnoredPlate({
                ...credentials,
                id,
                expectedVersion: input.row!.version,
                body,
              });
      if (row.deletedAt) await localDb.lprIgnoredPlates.delete(id);
      else await localDb.lprIgnoredPlates.put(row);
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
    localDb.lprIgnoredPlates,
    localDb.pendingOps,
    async () => {
      const pending = await localDb.pendingOps
        .where('entityType')
        .equals('lprIgnoredPlate')
        .filter((op) => op.tenantId === input.tenantId && op.entityId === id)
        .toArray();
      const editable = pending.find(
        (op) => op.status === 'pending' && op.operation !== 'delete',
      );
      if (
        pending.some((op) => op.status === 'conflict' || op.status === 'failed')
      ) {
        throw new ApiError(409, 'Unresolved whitelist operation', null);
      }
      if (operation === 'delete' && editable?.operation === 'create') {
        await localDb.pendingOps.delete(editable.localId!);
        await localDb.lprIgnoredPlates.delete(id);
        return;
      }
      const now = new Date().toISOString();
      const next: LocalLprIgnoredPlate = {
        id,
        tenantId: input.tenantId,
        plate: input.row?.plate ?? '',
        active: true,
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
          body: UpdateLprIgnoredPlateDto;
        };
        next.version =
          editable.operation === 'create' ? 1 : previous.expectedVersion + 1;
        const payload =
          operation === 'delete'
            ? { expectedVersion: previous.expectedVersion }
            : editable.operation === 'create'
              ? { ...(editable.payload as CreateLprIgnoredPlateDto), ...body }
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
          entityType: 'lprIgnoredPlate',
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
      await localDb.lprIgnoredPlates.put(next);
    },
  );
}
