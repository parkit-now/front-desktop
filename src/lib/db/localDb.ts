import Dexie, { type Table } from 'dexie';

export interface LocalRate {
  id: string;
  tenantId: string;
  name: string;
  hourPriceArs: string;
  stayPriceArs: string;
  fractionPriceArs: string;
  isActive: boolean;
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
  syncSeq: number;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface SyncState {
  key: string;
  lastSeq: number;
  lastSyncAt: string;
}

export type PendingOpStatus = 'pending' | 'in-flight' | 'failed';
export type PendingOpEntity = 'rate' | 'entry' | 'vehicle' | 'paymentMethod';
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
  }
}

export const localDb = new ParkitLocalDb();
