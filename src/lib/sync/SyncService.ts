import {
  type LocalCashSession,
  type LocalEntry,
  type LocalLprDetectionEvent,
  type LocalPaymentMethod,
  type LocalPaymentTransaction,
  type LocalRate,
  type LocalVehicle,
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
  pullVehicleCatalog,
  createTenantVehicle,
  updateTenantVehicle,
  deleteTenantVehicle,
  type VehicleCatalogItemDto,
} from '../api/vehicles';
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

function vehicleCatalogToLocal(v: VehicleCatalogItemDto): LocalVehicle {
  return {
    id: v.id,
    brand: v.brand,
    model: v.model,
    type: v.type ?? undefined,
    tenantId: v.tenantId ?? undefined,
    deletedAt: v.deletedAt ?? undefined,
    syncSeq: v.syncSeq,
    updatedAt: v.updatedAt,
    createdAt: v.createdAt,
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
    imageStoragePath: event.imageStoragePath ?? existing?.imageStoragePath,
    imageUrl: event.imageUrl ?? existing?.imageUrl,
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

  async pullVehicleCatalog(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;

    const tenantId = this.tenantId;
    const stateKey = `vehicles:${tenantId}`;
    const state = await localDb.syncState.get(stateKey);
    const afterSeq = state?.lastSeq ?? 0;

    const response = await pullVehicleCatalog({
      tenantId,
      bearer: this.accessToken,
      query: { afterSeq },
    });

    if (response.items.length > 0) {
      const deleted = response.items.filter((v) => v.deletedAt != null);
      const active = response.items.filter((v) => v.deletedAt == null);
      await localDb.transaction(
        'rw',
        localDb.vehicles,
        localDb.syncState,
        async () => {
          if (active.length > 0) {
            await localDb.vehicles.bulkPut(active.map(vehicleCatalogToLocal));
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
   */
  async pushLprDetectionEventImages(): Promise<void> {
    if (!this.tenantId || !this.accessToken) return;
    const tenantId = this.tenantId;
    const bearer = this.accessToken;

    const candidates = await localDb.lprDetectionEvents
      .where('tenantId')
      .equals(tenantId)
      .filter((event) => !event.imageStoragePath && !!event.bestCaptureId)
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

    const pending = await localDb.pendingOps
      .where('[tenantId+status]')
      .equals([this.tenantId, 'pending'])
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
          | LocalCashSession
          | LocalLprDetectionEvent
          | undefined;

        if (op.entityType === 'rate') {
          serverEntity = await this.applyRateOp(op);
        } else if (op.entityType === 'entry') {
          serverEntity = await this.applyEntryOp(op);
        } else if (op.entityType === 'vehicle') {
          serverEntity = await this.applyVehicleOp(op);
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
      return vehicleCatalogToLocal(result);
    }

    if (op.operation === 'update') {
      const payload = op.payload as Parameters<
        typeof updateTenantVehicle
      >[0]['body'];
      const result = await updateTenantVehicle({
        tenantId,
        bearer,
        id: op.entityId,
        body: payload,
      });
      return vehicleCatalogToLocal(result);
    }

    if (op.operation === 'delete') {
      await deleteTenantVehicle({ tenantId, bearer, id: op.entityId });
      return undefined;
    }

    throw new Error(`Unknown vehicle operation: ${String(op.operation)}`);
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

  async fullSync(): Promise<void> {
    await this.pushPendingOps();
    await this.pullCashSessions();
    await this.pullRates();
    await this.pullEntries();
    await this.pullLprDetectionEvents();
    await this.pushLprDetectionEventImages();
    await this.pullPaymentMethods();
    await this.pullVehicleCatalog();
    await this.pullPaymentTransactions();
  }
}

export const syncService = new SyncService();
