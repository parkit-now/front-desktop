import { ApiError } from '../../lib/api/client';
import {
  writePlateProfile,
  type UpdatePlateProfileDto,
} from '../../lib/api/plate-profiles';
import {
  localDb,
  type LocalPlateProfile,
  type PendingOpOperation,
} from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import { generateUuidV7 } from '../entries/entryUtils';
import {
  emptyPlateProfile,
  plateProfileKey,
  profileToLocal,
} from './plateProfiles';

export type PlateProfileFields = Pick<
  UpdatePlateProfileDto,
  'vehicleBrand' | 'vehicleModel' | 'vehicleTypeId' | 'color' | 'rateId'
>;

export async function mutatePlateProfile(input: {
  tenantId: string;
  bearer: string;
  userId: string;
  isOnline: boolean;
  plate: string;
  row?: LocalPlateProfile;
  body?: PlateProfileFields;
  remove?: boolean;
  labels?: { vehicleTypeName: string | null; rateName: string | null };
}) {
  const key = plateProfileKey(input.tenantId, input.plate);
  const current = input.row ?? (await localDb.plateProfiles.get(key));
  const operation: PendingOpOperation = input.remove
    ? 'delete'
    : input.row && !input.row.deletedAt
      ? 'update'
      : 'create';
  const body: UpdatePlateProfileDto = {
    ...input.body,
    occurredAt: new Date().toISOString(),
    expectedVersion: current?.editVersion ?? 0,
    mutationId: generateUuidV7(),
  };
  const queued = await localDb.pendingOps
    .where('entityType')
    .equals('plateProfile')
    .filter(
      (op) => op.tenantId === input.tenantId && op.entityId === input.plate,
    )
    .toArray();
  if (
    queued.some(
      (op) =>
        op.status === 'conflict' ||
        op.status === 'failed' ||
        op.status === 'in-flight',
    )
  )
    throw new ApiError(409, 'Profile needs reconciliation', null);
  if (input.isOnline && queued.length === 0) {
    try {
      const row = await writePlateProfile({ ...input, operation, body });
      await localDb.plateProfiles.put(profileToLocal(row));
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
    localDb.plateProfiles,
    localDb.pendingOps,
    async () => {
      const pending = await localDb.pendingOps
        .where('entityType')
        .equals('plateProfile')
        .filter(
          (op) => op.tenantId === input.tenantId && op.entityId === input.plate,
        )
        .toArray();
      if (
        pending.some(
          (op) => op.status !== 'pending' || op.userId !== input.userId,
        )
      )
        throw new ApiError(409, 'Profile needs reconciliation', null);
      // A sent mutation may already have a server receipt even when its reply
      // was lost. Preserve it and append a new version instead of rewriting it.
      await enqueuePendingOp(
        {
          entityType: 'plateProfile',
          operation,
          tenantId: input.tenantId,
          entityId: input.plate,
          payload: body,
          status: 'pending',
        },
        input.userId,
      );
      const now = body.occurredAt;
      await localDb.plateProfiles.put({
        ...(current ?? emptyPlateProfile(input.tenantId, input.plate)),
        ...input.body,
        ...input.labels,
        editVersion: body.expectedVersion + 1,
        learnAfter: now,
        deletedAt: input.remove ? now : null,
        updatedAt: now,
      });
    },
  );
}
