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
  /**
   * Set when the backend soft-deleted the rate. Rows that arrive with it are
   * deleted locally by `pullRates`, so in practice this is never persisted —
   * it's kept for the same defensive reason as `LocalVehicle.deletedAt`.
   */
  deletedAt?: string;
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
  /** FK a `LocalVehicleType` del mismo tenant. */
  typeId: string;
  /**
   * Ya no es opcional: se acabó el catálogo global (`tenantId` nulo). La v11
   * borra las filas viejas que lo tenían en null.
   */
  tenantId: string;
  deletedAt?: string;
  /**
   * Versión de la fila para optimistic locking. El backend exige
   * `?expectedVersion=N` en PATCH y DELETE.
   *
   * Dejó de ser opcional: la v10 y la v11 forzaron sendos re-pull completos,
   * así que no puede quedar una fila sin `version`. Un `version: 1` puesto por
   * un fallback silencioso es peor que un error visible — chocaría contra el
   * optimistic locking y el operador vería un 409 sin entender por qué.
   */
  version: number;
  syncSeq: number;
  updatedAt: string;
  createdAt: string;
}

/**
 * Tipo de vehículo, uno por estacionamiento. Reemplaza al enum `vehicle_type`
 * que la plataforma decidía por todos.
 */
export interface LocalVehicleType {
  id: string;
  tenantId: string;
  name: string;
  /** Si el estacionamiento acepta este tipo. Reemplaza a ServiceCode.VEHICLE_*. */
  accepted: boolean;
  /** Defensa: el pull borra los tombstones en vez de persistirlos. */
  deletedAt?: string;
  version: number;
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
  | 'vehicleType'
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
  vehicleTypes!: Table<LocalVehicleType>;
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

    // v9: LocalRate gains `deletedAt` (no index change needed) — the backend
    // now soft-deletes rates, so `/rates/changes` ships tombstones and
    // `pullRates` removes them from the local copy.
    this.version(9).stores({});

    // v10: LocalVehicle gains `version` (no index change needed). El backend
    // ahora exige `?expectedVersion=N` en PATCH y DELETE de vehículos.
    //
    // Se resetea el cursor `vehicles:*` para que el próximo pull re-baje el
    // catálogo entero y rellene `version` en las filas sincronizadas antes de
    // esta versión. Sin eso, editar una fila vieja manda
    // `expectedVersion=undefined` y el backend responde 400. Mismo patrón que
    // la v6 con `paymentMethods:`.
    //
    // Además se descartan las operaciones de vehículo que quedaron encoladas:
    // su payload se armó sin `version`, así que al reconectar fallarían con 400
    // y quedarían en `failed` — un estado que `pushPendingOps` nunca reintenta
    // pero que `pendingCount` SÍ cuenta, dejando al usuario con un badge de
    // pendientes que no baja nunca.
    this.version(10)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' && s.key.startsWith('vehicles:'),
          )
          .delete();
        await tx
          .table('pendingOps')
          .toCollection()
          .filter((op: PendingOp) => op.entityType === 'vehicle')
          .delete();
      });

    // v11: se elimina el catálogo GLOBAL y el tipo de vehículo pasa de un enum
    // a la tabla `vehicleTypes`, una por estacionamiento.
    //
    // `LocalVehicle` cambia `type` (string del enum) por `typeId` (FK), y
    // `tenantId`/`version` dejan de ser opcionales.
    this.version(11)
      .stores({ vehicleTypes: 'id, syncSeq, tenantId' })
      .upgrade(async (tx) => {
        // 1. Reset del cursor: las filas viejas traen `type`, no `typeId`.
        await tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' && s.key.startsWith('vehicles:'),
          )
          .delete();

        // 2. Las ops de vehículo encoladas llevan `type` en el payload, que el
        //    backend nuevo rechaza con 400 -> quedarían en `failed` para
        //    siempre y `pendingCount` las seguiría contando. Mismo argumento
        //    que la v10.
        await tx
          .table('pendingOps')
          .toCollection()
          .filter((op: PendingOp) => op.entityType === 'vehicle')
          .delete();

        // 3. ESTE es el paso que no es obvio. Resetear el cursor sirve para
        //    RELLENAR campos, porque el servidor reenvía cada fila. NO sirve
        //    para filas que dejaron de existir: el pull hace `bulkPut` de lo
        //    activo y `bulkDelete` de los tombstones, así que una fila sobre la
        //    que el servidor no tiene opinión es INVISIBLE al sync.
        //
        //    Los vehículos globales son exactamente ese caso: post-migración el
        //    backend tiene copias por tenant con ids NUEVOS y nunca vuelve a
        //    mencionar los viejos. Sin este borrado sobreviven para siempre y
        //    el autocompletado del ingreso los sigue ofreciendo.
        //
        //    Borrado dirigido y no `.clear()`: alguien que esté OFFLINE durante
        //    el upgrade se quedaría sin catálogo hasta reconectar, y el
        //    formulario de ingreso bloquea el alta con catálogo vacío. Así
        //    conserva las filas propias del tenant durante esa ventana.
        await tx
          .table('vehicles')
          .toCollection()
          .filter((v: { tenantId?: string }) => v.tenantId == null)
          .delete();
      });
  }
}

export const localDb = new ParkitLocalDb();
