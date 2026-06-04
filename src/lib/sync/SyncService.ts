import {
  type LocalEntry,
  type LocalRate,
  type PendingOp,
  localDb,
} from '../db/localDb';
import {
  createEntry,
  closeEntry,
  pullEntryChanges,
  type EntryDto,
} from '../api/entries';
import {
  createRate,
  deactivateRate,
  pullRateChanges,
  updateRate,
  type RateDto,
} from '../api/rates';
import { createVehicle } from '../api/vehicles';

function rateToLocal(r: RateDto): LocalRate {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    hourPriceArs: String(r.hourPriceArs),
    stayPriceArs: String(r.stayPriceArs),
    fractionPriceArs: String(r.fractionPriceArs),
    isActive: r.isActive,
    version: r.version,
    syncSeq: r.syncSeq,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function entryToLocal(e: EntryDto): LocalEntry {
  return {
    id: e.id,
    tenantId: e.tenantId,
    plate: e.plate,
    color: e.color ?? undefined,
    enteredAt: e.enteredAt,
    leftAt: e.leftAt ?? undefined,
    amountPaid: e.amountPaid !== null ? String(e.amountPaid) : undefined,
    vehicleId: e.vehicleId,
    rateId: e.rateId ?? undefined,
    rateSnapshotName: e.rateSnapshotName ?? undefined,
    rateSnapshotHourPriceArs:
      e.rateSnapshotHourPriceArs !== null
        ? String(e.rateSnapshotHourPriceArs)
        : undefined,
    rateSnapshotStayPriceArs:
      e.rateSnapshotStayPriceArs !== null
        ? String(e.rateSnapshotStayPriceArs)
        : undefined,
    rateSnapshotFractionPriceArs:
      e.rateSnapshotFractionPriceArs !== null
        ? String(e.rateSnapshotFractionPriceArs)
        : undefined,
    version: e.version,
    syncSeq: e.syncSeq,
    updatedAt: e.updatedAt,
  };
}

class SyncService {
  private tenantId = '';
  private accessToken = '';

  setCredentials(tenantId: string, accessToken: string): void {
    this.tenantId = tenantId;
    this.accessToken = accessToken;
  }

  async pullRates(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const stateKey = `rates:${this.tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullRateChanges({
      tenantId: this.tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      await localDb.transaction(
        'rw',
        localDb.rates,
        localDb.syncState,
        async () => {
          await localDb.rates.bulkPut(response.items.map(rateToLocal));
          await localDb.syncState.put({
            key: stateKey,
            lastSeq: response.maxSeq,
            lastSyncAt: new Date().toISOString(),
          });
        },
      );
    } else {
      await localDb.syncState.put({
        key: stateKey,
        lastSeq: afterSeq,
        lastSyncAt: new Date().toISOString(),
      });
    }
  }

  async pullEntries(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const stateKey = `entries:${this.tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullEntryChanges({
      tenantId: this.tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      await localDb.transaction(
        'rw',
        localDb.entries,
        localDb.syncState,
        async () => {
          await localDb.entries.bulkPut(response.items.map(entryToLocal));
          await localDb.syncState.put({
            key: stateKey,
            lastSeq: response.maxSeq,
            lastSyncAt: new Date().toISOString(),
          });
        },
      );
    } else {
      await localDb.syncState.put({
        key: stateKey,
        lastSeq: afterSeq,
        lastSyncAt: new Date().toISOString(),
      });
    }
  }

  async pushPendingOps(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const pending = await localDb.pendingOps
      .where('[tenantId+status]')
      .equals([this.tenantId, 'pending'])
      .sortBy('localId');

    for (const op of pending) {
      if (op.localId === undefined) continue;
      await localDb.pendingOps.update(op.localId, { status: 'in-flight' });

      try {
        let serverEntity: LocalRate | LocalEntry | undefined;

        if (op.entityType === 'rate') {
          serverEntity = await this.applyRateOp(op);
        } else if (op.entityType === 'entry') {
          serverEntity = await this.applyEntryOp(op);
        } else if (op.entityType === 'vehicle') {
          await this.applyVehicleOp(op);
        }

        await localDb.transaction(
          'rw',
          localDb.pendingOps,
          localDb.rates,
          localDb.entries,
          async () => {
            await localDb.pendingOps.update(op.localId!, {
              status: 'failed',
              error: undefined,
            });
            // Mark done by removing the op (keeps the table clean)
            await localDb.pendingOps.delete(op.localId!);

            // Update local entity with server response (gets server-assigned syncSeq etc.)
            if (serverEntity) {
              if (op.entityType === 'rate') {
                await localDb.rates.put(serverEntity as LocalRate);
              } else if (op.entityType === 'entry') {
                await localDb.entries.put(serverEntity as LocalEntry);
              }
            }
          },
        );
      } catch (error) {
        await localDb.pendingOps.update(op.localId, {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          retryCount: (op.retryCount ?? 0) + 1,
        });
      }
    }
  }

  private async applyVehicleOp(op: PendingOp): Promise<void> {
    if (op.operation !== 'create') return;
    const payload = op.payload as Parameters<typeof createVehicle>[0]['body'];
    await createVehicle({ bearer: this.accessToken, body: payload });
  }

  private async applyRateOp(op: PendingOp): Promise<LocalRate> {
    const bearer = this.accessToken;
    const tenantId = this.tenantId;

    if (op.operation === 'create') {
      const payload = op.payload as Parameters<typeof createRate>[0]['body'];
      const result = await createRate({ tenantId, bearer, body: payload });
      return rateToLocal(result);
    }

    if (op.operation === 'update') {
      const payload = op.payload as {
        expectedVersion: number;
        body: Parameters<typeof updateRate>[0]['body'];
      };
      const result = await updateRate({
        tenantId,
        rateId: op.entityId,
        expectedVersion: payload.expectedVersion,
        bearer,
        body: payload.body,
      });
      return rateToLocal(result);
    }

    if (op.operation === 'delete') {
      const payload = op.payload as { expectedVersion: number };
      await deactivateRate({
        tenantId,
        rateId: op.entityId,
        expectedVersion: payload.expectedVersion,
        bearer,
      });
      await localDb.rates.delete(op.entityId);
    }

    throw new Error(`Unknown rate operation: ${op.operation}`);
  }

  private async applyEntryOp(op: PendingOp): Promise<LocalEntry> {
    const bearer = this.accessToken;
    const tenantId = this.tenantId;

    if (op.operation === 'create') {
      const payload = op.payload as Parameters<typeof createEntry>[0]['body'];
      const result = await createEntry({ tenantId, bearer, body: payload });
      return entryToLocal(result);
    }

    if (op.operation === 'update') {
      const payload = op.payload as {
        expectedVersion: number;
        body: Parameters<typeof closeEntry>[0]['body'];
      };
      const result = await closeEntry({
        tenantId,
        entryId: op.entityId,
        expectedVersion: payload.expectedVersion,
        bearer,
        body: payload.body,
      });
      return entryToLocal(result);
    }

    throw new Error(`Unknown entry operation: ${op.operation}`);
  }

  async fullSync(): Promise<void> {
    await this.pushPendingOps();
    await this.pullRates();
    await this.pullEntries();
  }
}

export const syncService = new SyncService();
