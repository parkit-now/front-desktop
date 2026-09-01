import { splitTombstones } from './tombstones';
import {
  type LocalCashSession,
  type LocalEntry,
  type LocalLprDetectionEvent,
  type LocalPaymentMethod,
  type LocalPaymentTransaction,
  type LocalRate,
  type LocalVehicle,
  type LocalVehicleType,
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
import {
  pullVehicleChanges,
  createTenantVehicle,
  updateTenantVehicle,
  deleteTenantVehicle,
  type VehicleDto,
} from '../api/vehicles';
import {
  createVehicleType,
  deleteVehicleType,
  pullVehicleTypeChanges,
  updateVehicleType,
  type VehicleTypeDto,
} from '../api/vehicle-types';
import {
  createPaymentMethod,
  deletePaymentMethod,
  togglePaymentMethod,
  pullPaymentMethodChanges,
  type PaymentMethodDto,
} from '../api/payment-methods';
import {
  createCashSession,
  pullCashSessionChanges,
  type CashSessionDto,
} from '../api/cash-sessions';
import {
  pullPaymentTransactionChanges,
  type PaymentTransactionDto,
} from '../api/payment-transactions';
import {
  pullLprDetectionEventChanges,
  updateLprDetectionEvent,
  upsertLprDetectionEvent,
  uploadLprDetectionEventImage,
  type LprDetectionEventDto,
} from '../api/lpr-events';
import { CAMERA_BASE_URL } from '../camera/constants';

function rateToLocal(r: RateDto): LocalRate {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    hourPriceArs: String(r.hourPriceArs),
    stayPriceArs: String(r.stayPriceArs),
    fractionPriceArs: String(r.fractionPriceArs),
    isActive: r.isActive,
    shortcutNumber: r.shortcutNumber ?? undefined,
    version: r.version,
    syncSeq: r.syncSeq,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt ?? undefined,
  };
}

function entryToLocal(e: EntryDto): LocalEntry {
  return {
    id: e.id,
    tenantId: e.tenantId,
    plate: e.plate,
    color: e.color ?? undefined,
    cochera: e.cochera ?? undefined,
    notes: e.notes ?? undefined,
    enteredAt: e.enteredAt,
    leftAt: e.leftAt ?? undefined,
    amountPaid: e.amountPaid !== null ? String(e.amountPaid) : undefined,
    vehicleBrand: e.vehicleBrand ?? undefined,
    vehicleModel: e.vehicleModel ?? undefined,
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
    cashSessionId: e.cashSessionId ?? undefined,
    ticketNumber: e.ticketNumber ?? undefined,
    version: e.version,
    syncSeq: e.syncSeq,
    updatedAt: e.updatedAt,
  };
}

function cashSessionToLocal(s: CashSessionDto): LocalCashSession {
  return {
    id: s.id,
    tenantId: s.tenantId,
    openedAt: s.openedAt,
    closedAt: s.closedAt ?? undefined,
    openingCash: s.openingCash,
    leavingCash: s.leavingCash ?? undefined,
    notes: s.notes ?? undefined,
    version: s.version,
    syncSeq: s.syncSeq,
    updatedAt: s.updatedAt,
  };
}

function paymentTransactionToLocal(
  t: PaymentTransactionDto,
): LocalPaymentTransaction {
  return {
    id: t.id,
    tenantId: t.tenantId,
    entryId: t.entryId,
    cashSessionId: t.cashSessionId ?? undefined,
    paymentMethodId: t.paymentMethodId ?? undefined,
    paymentMethodName: t.paymentMethodName,
    amount: t.amount,
    version: t.version,
    syncSeq: t.syncSeq,
    updatedAt: t.updatedAt,
  };
}

export function vehicleToLocal(v: VehicleDto): LocalVehicle {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    typeId: v.typeId,
    tenantId: v.tenantId,
    deletedAt: v.deletedAt ?? undefined,
    version: v.version,
    syncSeq: v.syncSeq,
    updatedAt: v.updatedAt,
    createdAt: v.createdAt,
  };
}

export function vehicleTypeToLocal(t: VehicleTypeDto): LocalVehicleType {
  return {
    id: t.id,
    tenantId: t.tenantId,
    name: t.name,
    accepted: t.accepted,
    deletedAt: t.deletedAt ?? undefined,
    version: t.version,
    syncSeq: t.syncSeq,
    updatedAt: t.updatedAt,
    createdAt: t.createdAt,
  };
}

function paymentMethodToLocal(pm: PaymentMethodDto): LocalPaymentMethod {
  return {
    id: pm.id,
    tenantId: '', // filled in by pullPaymentMethods via the context
    name: pm.name,
    enabled: pm.enabled,
    isDefault: pm.isDefault,
    isSystem: pm.isSystem,
    syncSeq: pm.syncSeq,
    version: pm.version,
    updatedAt: pm.updatedAt,
    createdAt: pm.createdAt,
  };
}

function lprDetectionEventToLocal(
  event: LprDetectionEventDto,
  existing?: LocalLprDetectionEvent,
): LocalLprDetectionEvent {
  return {
    id: event.id,
    tenantId: event.tenantId,
    cameraId: event.cameraId,
    location: event.location,
    firstSeenAt: event.firstSeenAt,
    lastSeenAt: event.lastSeenAt,
    rawText: event.rawText ?? existing?.rawText,
    normalizedText: event.normalizedText ?? existing?.normalizedText,
    displayPlate: event.displayPlate ?? existing?.displayPlate,
    confidence: event.confidence,
    formatValid: event.formatValid,
    formatType: event.formatType,
    qualityStatus: event.qualityStatus,
    status: event.status,
    entryId: event.entryId ?? undefined,
    reviewedAt: event.reviewedAt ?? undefined,
    // Server-authoritative fields: an explicit `null` (e.g. the retention job
    // purged the image) must clear the local copy, not fall back to the
    // stale cached value like the other optional fields above do.
    imageStoragePath: event.imageStoragePath ?? undefined,
    imageUrl: event.imageUrl ?? undefined,
    imageDeletedAt: event.imageDeletedAt ?? undefined,
    bestCaptureId: event.bestCaptureId ?? existing?.bestCaptureId,
    candidates:
      event.candidates.length > 0
        ? event.candidates
        : (existing?.candidates ?? []),
    version: event.version,
    syncSeq: event.syncSeq,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
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
      // A rate with `deletedAt` set is a tombstone: the backend soft-deleted it
      // and this is the only signal we get that it must go. Same split as
      // pullVehicleCatalog — without it a deleted rate would linger locally
      // forever, still showing up and still chargeable.
      const { active, deleted } = splitTombstones(response.items);
      await localDb.transaction(
        'rw',
        localDb.rates,
        localDb.syncState,
        async () => {
          if (active.length > 0) {
            await localDb.rates.bulkPut(active.map(rateToLocal));
          }
          if (deleted.length > 0) {
            await localDb.rates.bulkDelete(deleted.map((r) => r.id));
          }
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

  /**
   * Feed de tipos de vehículo. Molde idéntico al del catálogo: split de
   * tombstones, `bulkPut` de lo activo y `bulkDelete` de las bajas.
   */
  async pullVehicleTypes(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const tenantId = this.tenantId;
    const stateKey = `vehicleTypes:${tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullVehicleTypeChanges({
      tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      const { active, deleted } = splitTombstones(response.items);
      await localDb.transaction(
        'rw',
        localDb.vehicleTypes,
        localDb.syncState,
        async () => {
          if (active.length > 0) {
            await localDb.vehicleTypes.bulkPut(active.map(vehicleTypeToLocal));
          }
          if (deleted.length > 0) {
            await localDb.vehicleTypes.bulkDelete(deleted.map((t) => t.id));
          }
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

  async pullVehicleCatalog(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const tenantId = this.tenantId;
    const stateKey = `vehicles:${tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullVehicleChanges({
      tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      const { active, deleted } = splitTombstones(response.items);
      await localDb.transaction(
        'rw',
        localDb.vehicles,
        localDb.syncState,
        async () => {
          if (active.length > 0) {
            await localDb.vehicles.bulkPut(active.map(vehicleToLocal));
          }
          if (deleted.length > 0) {
            await localDb.vehicles.bulkDelete(deleted.map((v) => v.id));
          }
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

  async pullPaymentMethods(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const tenantId = this.tenantId;
    const stateKey = `paymentMethods:${tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullPaymentMethodChanges({
      tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      await localDb.transaction(
        'rw',
        localDb.paymentMethods,
        localDb.syncState,
        async () => {
          await localDb.paymentMethods.bulkPut(
            response.items.map((pm) => ({
              ...paymentMethodToLocal(pm),
              tenantId,
            })),
          );
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

  async pullCashSessions(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const stateKey = `cashSessions:${this.tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullCashSessionChanges({
      tenantId: this.tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      await localDb.transaction(
        'rw',
        localDb.cashSessions,
        localDb.syncState,
        async () => {
          await localDb.cashSessions.bulkPut(
            response.items.map(cashSessionToLocal),
          );
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

  async pullPaymentTransactions(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const stateKey = `paymentTransactions:${this.tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullPaymentTransactionChanges({
      tenantId: this.tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      await localDb.transaction(
        'rw',
        localDb.paymentTransactions,
        localDb.syncState,
        async () => {
          await localDb.paymentTransactions.bulkPut(
            response.items.map(paymentTransactionToLocal),
          );
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

  async pullLprDetectionEvents(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const stateKey = `lprDetectionEvents:${this.tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullLprDetectionEventChanges({
      tenantId: this.tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      await localDb.transaction(
        'rw',
        localDb.lprDetectionEvents,
        localDb.syncState,
        async () => {
          const existingRows = await localDb.lprDetectionEvents.bulkGet(
            response.items.map((item) => item.id),
          );
          await localDb.lprDetectionEvents.bulkPut(
            response.items.map((item, index) =>
              lprDetectionEventToLocal(item, existingRows[index]),
            ),
          );
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

  /**
   * Uploads the photo of every locally-known LPR event that doesn't have one
   * in Storage yet. Photos live only on the capturing machine's disk, served
   * by the local camera service — this pulls the bytes from there and hands
   * them to the backend, which is the only thing with Storage credentials.
   *
   * Scans (not a `pendingOps` entry) so it also catches events pulled from
   * other operators' sessions or left over from a crashed upload — those
   * simply 404 against this machine's camera service and get skipped.
   *
   * Excludes events with `imageDeletedAt` set: the backend's retention job
   * purges old photos on purpose, and a purged event still has no
   * `imageStoragePath` — without this check every sync would re-upload it.
   */
  async pushLprDetectionEventImages(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;
    const tenantId = this.tenantId;
    const bearer = this.accessToken;

    const candidates = await localDb.lprDetectionEvents
      .where('tenantId')
      .equals(tenantId)
      .filter(
        (event) =>
          !event.imageStoragePath &&
          !event.imageDeletedAt &&
          !!event.bestCaptureId &&
          event.status !== 'suppressed_pending_event',
      )
      .toArray();

    for (const event of candidates) {
      try {
        const captureResponse = await fetch(
          `${CAMERA_BASE_URL}/capture/${encodeURIComponent(event.bestCaptureId!)}/plate.jpg`,
        );
        if (!captureResponse.ok) continue;
        const image = await captureResponse.blob();

        const updated = await uploadLprDetectionEventImage({
          tenantId,
          bearer,
          eventId: event.id,
          image,
        });
        await localDb.lprDetectionEvents.put(
          lprDetectionEventToLocal(updated, event),
        );
      } catch {
        // Offline, or the local camera service isn't running — retried on
        // the next sync cycle since the row still has no imageStoragePath.
      }
    }
  }

  async pushPendingOps(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    // 'unreviewed' ops (audit-only LPR detections not yet acted on by the
    // operator) still need to reach the backend — they're just excluded from
    // the user-facing pending-changes count in SyncContext.
    const pending = await localDb.pendingOps
      .where('[tenantId+status]')
      .anyOf([
        [this.tenantId, 'pending'],
        [this.tenantId, 'unreviewed'],
      ])
      .sortBy('localId');

    for (const op of pending) {
      if (op.localId === undefined) continue;
      await localDb.pendingOps.update(op.localId, { status: 'in-flight' });

      try {
        let serverEntity:
          | LocalRate
          | LocalEntry
          | LocalPaymentMethod
          | LocalVehicle
          | LocalVehicleType
          | LocalCashSession
          | LocalLprDetectionEvent
          | undefined;

        if (op.entityType === 'rate') {
          serverEntity = await this.applyRateOp(op);
        } else if (op.entityType === 'entry') {
          serverEntity = await this.applyEntryOp(op);
        } else if (op.entityType === 'vehicle') {
          serverEntity = await this.applyVehicleOp(op);
        } else if (op.entityType === 'vehicleType') {
          serverEntity = await this.applyVehicleTypeOp(op);
        } else if (op.entityType === 'paymentMethod') {
          serverEntity = await this.applyPaymentMethodOp(op);
        } else if (op.entityType === 'cashSession') {
          serverEntity = await this.applyCashSessionOp(op);
        } else if (op.entityType === 'lprDetectionEvent') {
          serverEntity = await this.applyLprDetectionEventOp(op);
        }

        await localDb.transaction(
          'rw',
          [
            localDb.pendingOps,
            localDb.rates,
            localDb.entries,
            localDb.vehicles,
            localDb.vehicleTypes,
            localDb.paymentMethods,
            localDb.cashSessions,
            localDb.lprDetectionEvents,
          ],
          async () => {
            await localDb.pendingOps.delete(op.localId!);

            if (serverEntity) {
              if (op.entityType === 'rate') {
                await localDb.rates.put(serverEntity as LocalRate);
              } else if (op.entityType === 'entry') {
                await localDb.entries.put(serverEntity as LocalEntry);
              } else if (op.entityType === 'vehicle') {
                await localDb.vehicles.put(serverEntity as LocalVehicle);
              } else if (op.entityType === 'vehicleType') {
                await localDb.vehicleTypes.put(
                  serverEntity as LocalVehicleType,
                );
              } else if (op.entityType === 'paymentMethod') {
                await localDb.paymentMethods.put(
                  serverEntity as LocalPaymentMethod,
                );
              } else if (op.entityType === 'cashSession') {
                await localDb.cashSessions.put(
                  serverEntity as LocalCashSession,
                );
              } else if (op.entityType === 'lprDetectionEvent') {
                await localDb.lprDetectionEvents.put(
                  serverEntity as LocalLprDetectionEvent,
                );
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

  private async applyVehicleOp(
    op: PendingOp,
  ): Promise<LocalVehicle | undefined> {
    const tenantId = this.tenantId;
    const bearer = this.accessToken;

    if (op.operation === 'create') {
      const payload = op.payload as Parameters<
        typeof createTenantVehicle
      >[0]['body'];
      const result = await createTenantVehicle({
        tenantId,
        bearer,
        body: payload,
      });
      return vehicleToLocal(result);
    }

    // El backend exige `expectedVersion` en PATCH y DELETE, así que el panel lo
    // encola junto al body al guardar offline. Sin él, la op saldría con
    // `expectedVersion=undefined` y volvería con 400.
    if (op.operation === 'update') {
      const payload = op.payload as {
        expectedVersion: number;
        body: Parameters<typeof updateTenantVehicle>[0]['body'];
      };
      const result = await updateTenantVehicle({
        tenantId,
        bearer,
        vehicleId: op.entityId,
        expectedVersion: payload.expectedVersion,
        body: payload.body,
      });
      return vehicleToLocal(result);
    }

    if (op.operation === 'delete') {
      const payload = op.payload as { expectedVersion: number };
      await deleteTenantVehicle({
        tenantId,
        bearer,
        vehicleId: op.entityId,
        expectedVersion: payload.expectedVersion,
      });
      return undefined;
    }

    throw new Error(`Unknown vehicle operation: ${String(op.operation)}`);
  }

  /**
   * Calcado de `applyVehicleOp`.
   *
   * OJO: el borrado NO acepta `reassignToTypeId` acá. Borrar un tipo en uso son
   * dos llamadas dependientes con un bulk update del lado del servidor, y su
   * modo de falla offline es una divergencia silenciosa entre los `typeId`
   * locales y los del backend. El panel gatea esa acción con `isOnline`; altas,
   * renombres y borrados simples (0 vehículos) sí funcionan offline.
   */
  private async applyVehicleTypeOp(
    op: PendingOp,
  ): Promise<LocalVehicleType | undefined> {
    const tenantId = this.tenantId;
    const bearer = this.accessToken;

    if (op.operation === 'create') {
      const payload = op.payload as Parameters<
        typeof createVehicleType
      >[0]['body'];
      const result = await createVehicleType({
        tenantId,
        bearer,
        body: payload,
      });
      return vehicleTypeToLocal(result);
    }

    if (op.operation === 'update') {
      const payload = op.payload as {
        expectedVersion: number;
        body: Parameters<typeof updateVehicleType>[0]['body'];
      };
      const result = await updateVehicleType({
        tenantId,
        bearer,
        typeId: op.entityId,
        expectedVersion: payload.expectedVersion,
        body: payload.body,
      });
      return vehicleTypeToLocal(result);
    }

    if (op.operation === 'delete') {
      const payload = op.payload as { expectedVersion: number };
      await deleteVehicleType({
        tenantId,
        bearer,
        typeId: op.entityId,
        expectedVersion: payload.expectedVersion,
      });
      return undefined;
    }

    throw new Error(`Unknown vehicleType operation: ${String(op.operation)}`);
  }

  private async applyRateOp(op: PendingOp): Promise<LocalRate | undefined> {
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
      return undefined;
    }

    throw new Error(`Unknown rate operation: ${String(op.operation)}`);
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

  private async applyCashSessionOp(
    op: PendingOp,
  ): Promise<LocalCashSession | undefined> {
    const tenantId = this.tenantId;
    const bearer = this.accessToken;

    if (op.operation === 'create') {
      const payload = op.payload as Parameters<
        typeof createCashSession
      >[0]['body'];
      const result = await createCashSession({
        tenantId,
        bearer,
        body: payload,
      });
      return cashSessionToLocal(result);
    }

    throw new Error(`Unknown cashSession operation: ${String(op.operation)}`);
  }

  private async applyLprDetectionEventOp(
    op: PendingOp,
  ): Promise<LocalLprDetectionEvent | undefined> {
    const tenantId = this.tenantId;
    const bearer = this.accessToken;

    if (op.operation === 'create') {
      const payload = op.payload as Parameters<
        typeof upsertLprDetectionEvent
      >[0]['body'];
      const result = await upsertLprDetectionEvent({
        tenantId,
        bearer,
        body: payload,
      });
      const existing = await localDb.lprDetectionEvents.get(op.entityId);
      return lprDetectionEventToLocal(result, existing);
    }

    if (op.operation === 'update') {
      const payload = op.payload as Parameters<
        typeof updateLprDetectionEvent
      >[0]['body'];
      const result = await updateLprDetectionEvent({
        tenantId,
        bearer,
        eventId: op.entityId,
        body: payload,
      });
      const existing = await localDb.lprDetectionEvents.get(op.entityId);
      return lprDetectionEventToLocal(result, existing);
    }

    throw new Error(`Unknown lprDetectionEvent operation: ${op.operation}`);
  }

  private async applyPaymentMethodOp(
    op: PendingOp,
  ): Promise<LocalPaymentMethod | undefined> {
    const bearer = this.accessToken;
    const tenantId = this.tenantId;

    if (op.operation === 'create') {
      const payload = op.payload as { name: string; type?: string };
      const result = await createPaymentMethod({
        tenantId,
        bearer,
        body: payload,
      });
      return { ...paymentMethodToLocal(result), tenantId };
    }

    if (op.operation === 'update') {
      const payload = op.payload as { enabled?: boolean; isDefault?: boolean };
      const result = await togglePaymentMethod({
        tenantId,
        bearer,
        id: op.entityId,
        body: payload,
      });
      return { ...paymentMethodToLocal(result), tenantId };
    }

    if (op.operation === 'delete') {
      await deletePaymentMethod({ tenantId, bearer, id: op.entityId });
      await localDb.paymentMethods.delete(op.entityId);
      return undefined;
    }

    throw new Error(`Unknown paymentMethod operation: ${String(op.operation)}`);
  }

  /**
   * Sincronización completa.
   *
   * Cada etapa corre AISLADA. Antes eran nueve `await` en secuencia y sin
   * try/catch: la primera que fallaba abortaba todas las siguientes. Con
   * `pullVehicleCatalog` en la octava posición, un 500 en `pullEntries` dejaba
   * el catálogo de vehículos sin bajar — y como el formulario de ingreso exige
   * elegir un vehículo del catálogo, el operador no podía registrar NINGÚN
   * ingreso hasta el próximo sync exitoso. Una falla en un dato accesorio
   * volteaba la operación entera.
   *
   * El orden también cambió: primero se sube lo pendiente, y enseguida van los
   * dos catálogos que el ingreso necesita sí o sí (vehículos y tarifas). Lo
   * accesorio queda para el final.
   *
   * Si alguna etapa falla se sigue con las demás y recién al terminar se lanza
   * un error con todas las que fallaron, para que el SyncButton lo muestre.
   */
  async fullSync(): Promise<void> {
    const stages: [string, () => Promise<void>][] = [
      ['cambios pendientes', () => this.pushPendingOps()],
      // Los dos catálogos que bloquean el alta de ingresos van primero.
      //
      // Los TIPOS van antes que el catálogo: los vehículos cargan `typeId`, así
      // que si los tipos fallan pero los vehículos entran, cada fila aterriza
      // con una FK que no resuelve y la columna Tipo se va a "—" en bloque —
      // que se lee como "me borraron las categorías". Las etapas son
      // independientes a propósito, así que esto achica la ventana, no la
      // elimina: el panel igual tiene que renderizar con gracia un typeId
      // irresoluble.
      ['tipos de vehículo', () => this.pullVehicleTypes()],
      ['catálogo de vehículos', () => this.pullVehicleCatalog()],
      ['tarifas', () => this.pullRates()],
      ['métodos de pago', () => this.pullPaymentMethods()],
      ['cajas', () => this.pullCashSessions()],
      ['ingresos', () => this.pullEntries()],
      ['detecciones', () => this.pullLprDetectionEvents()],
      ['imágenes de detecciones', () => this.pushLprDetectionEventImages()],
      ['pagos', () => this.pullPaymentTransactions()],
    ];

    const failures: string[] = [];

    for (const [label, run] of stages) {
      try {
        await run();
      } catch (error) {
        failures.push(label);
        console.error(`[sync] Falló la etapa "${label}"`, error);
      }
    }

    if (failures.length > 0) {
      throw new Error(`No se pudo sincronizar: ${failures.join(', ')}.`);
    }
  }
}

export const syncService = new SyncService();
