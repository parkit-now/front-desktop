import Dexie, { type Table } from 'dexie';

export interface LocalRate {
  id: string;
  tenantId: string;
  name: string;
  hourPriceArs: string;
  stayPriceArs: string;
  fractionPriceArs: string;
  isActive: boolean;
  shortcutNumber?: number;
  version: number;
  syncSeq: number;
  createdAt: string;
  updatedAt: string;
}

export interface LocalEntry {
  id: string;
  tenantId: string;
  plate: string;
  color?: string;
  cochera?: string;
  notes?: string;
  enteredAt: string;
  leftAt?: string;
  amountPaid?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  rateId?: string;
  rateSnapshotName?: string;
  rateSnapshotHourPriceArs?: string;
  rateSnapshotStayPriceArs?: string;
  rateSnapshotFractionPriceArs?: string;
  cashSessionId?: string;
  ticketNumber?: number;
  version: number;
  syncSeq: number;
  updatedAt: string;
}

export interface LocalCashSession {
  id: string;
  tenantId: string;
  openedAt: string;
  closedAt?: string;
  openingCash: number;
  leavingCash?: number;
  notes?: string;
  version: number;
  syncSeq: number;
  updatedAt: string;
}

export interface LocalPaymentTransaction {
  id: string;
  tenantId: string;
  entryId: string;
  cashSessionId?: string;
  paymentMethodId?: string;
  paymentMethodName: string;
  amount: number;
  version: number;
  syncSeq: number;
  updatedAt: string;
}

export interface LocalVehicle {
  id: string;
  brand: string;
  model: string;
  type?: string;
  tenantId?: string;
  deletedAt?: string;
  syncSeq: number;
  updatedAt: string;
  createdAt: string;
}

export interface LocalPaymentMethod {
  id: string;
  tenantId: string;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  isSystem: boolean;
  syncSeq: number;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export type LprDetectionStatus =
  | 'pending'
  | 'registered'
  | 'dismissed'
  | 'suppressed_active_entry'
  | 'suppressed_pending_event'
  | 'suppressed_recent_exit';

export type LprFormatType = 'argentina_old' | 'argentina_mercosur' | 'unknown';

export type LprQualityStatus =
  | 'valid_high'
  | 'valid_low'
  | 'invalid_format'
  | 'low_confidence';

export interface LocalLprDetectionEvent {
  id: string;
  tenantId: string;
  cameraId: string;
  location: string;
  firstSeenAt: string;
  lastSeenAt: string;
  rawText?: string;
  normalizedText?: string;
  displayPlate?: string;
  confidence: number;
  formatValid: boolean;
  formatType: LprFormatType;
  qualityStatus: LprQualityStatus;
  status: LprDetectionStatus;
  entryId?: string;
  reviewedAt?: string;
  imageStoragePath?: string;
  imageUrl?: string;
  imageDeletedAt?: string;
  bestCaptureId?: string;
  candidates: unknown[];
  version: number;
  syncSeq: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncState {
  key: string;
  lastSeq: number;
  lastSyncAt: string;
}

// 'unreviewed' is for audit-only ops (e.g. a freshly-detected LPR plate the
// operator hasn't registered/dismissed yet) — they still get pushed like any
// other op, but are excluded from the user-facing pending-changes count.
export type PendingOpStatus = 'unreviewed' | 'pending' | 'in-flight' | 'failed';
export type PendingOpEntity =
  | 'rate'
  | 'entry'
  | 'vehicle'
  | 'paymentMethod'
  | 'cashSession'
  | 'lprDetectionEvent';
export type PendingOpOperation = 'create' | 'update' | 'delete';

export interface PendingOp {
  localId?: number;
  entityType: PendingOpEntity;
  operation: PendingOpOperation;
  tenantId: string;
  entityId: string;
  payload: unknown;
  status: PendingOpStatus;
  createdAt: number;
  retryCount: number;
  error?: string;
}

class ParkitLocalDb extends Dexie {
  rates!: Table<LocalRate>;
  entries!: Table<LocalEntry>;
  vehicles!: Table<LocalVehicle>;
  paymentMethods!: Table<LocalPaymentMethod>;
  lprDetectionEvents!: Table<LocalLprDetectionEvent>;
  cashSessions!: Table<LocalCashSession>;
  paymentTransactions!: Table<LocalPaymentTransaction>;
  syncState!: Table<SyncState>;
  pendingOps!: Table<PendingOp>;

  constructor() {
    super('parkit-local');

    this.version(1).stores({
      rates: 'id, [tenantId+syncSeq], [tenantId+isActive], tenantId',
      entries: 'id, [tenantId+syncSeq], tenantId, plate',
      vehicles: 'id',
      paymentMethods: 'id, tenantId',
      syncState: 'key',
      pendingOps: '++localId, status, entityType, [tenantId+status]',
    });

    // v2: add plate index to vehicles; add syncSeq index to paymentMethods
    this.version(2).stores({
      vehicles: 'id, plate',
      paymentMethods: 'id, tenantId, [tenantId+syncSeq]',
    });

    // v3: vehicles become a synced catalog (syncSeq index, no plate)
    this.version(3).stores({
      vehicles: 'id, syncSeq, tenantId',
    });

    // v4: LocalVehicle gains deletedAt field (no index change needed)
    this.version(4).stores({});

    // v5: add cashSessions and paymentTransactions tables; add cashSessionId index to entries
    this.version(5).stores({
      entries: 'id, [tenantId+syncSeq], tenantId, plate, cashSessionId',
      cashSessions: 'id, [tenantId+syncSeq], tenantId',
      paymentTransactions:
        'id, [tenantId+syncSeq], tenantId, entryId, cashSessionId',
    });

    // v6: LocalPaymentMethod gains `isSystem` (no index change). Reset the
    // payment-method sync cursor so the next pull re-fetches every method and
    // backfills the new field on rows synced before this version.
    this.version(6)
      .stores({})
      .upgrade((tx) =>
        tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' && s.key.startsWith('paymentMethods:'),
          )
          .delete(),
      );

    // v7: auditable LPR detection events synced with the backend.
    this.version(7).stores({
      lprDetectionEvents:
        'id, tenantId, status, normalizedText, [tenantId+syncSeq], [tenantId+status], [tenantId+normalizedText]',
    });

    // v8: LocalLprDetectionEvent gains `imageDeletedAt` (no index change
    // needed) — marks images purged server-side by the retention job, so
    // sync stops treating the row as still needing an image upload.
    this.version(8).stores({});
  }
}

export const localDb = new ParkitLocalDb();
