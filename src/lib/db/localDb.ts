import Dexie, { type Table } from 'dexie';
import type { components } from '../../generated/api-types';

/**
 * Qué ES un medio de pago, contra su `name`, que es cómo el dueño decidió
 * llamarlo. El arqueo de caja decide con ESTO, nunca con el nombre.
 *
 * Se toma del contrato generado (`src/generated/api-types.ts`) y no se
 * redeclara a mano: si el backend agrega un valor al enum, este tipo se entera
 * y el `switch` que lo use deja de compilar. Escribirlo a mano sería una
 * segunda fuente de verdad silenciosa.
 */
export type PaymentMethodKind = components['schemas']['PaymentMethodType'];
export type PaymentMethodInvoiceMode =
  components['schemas']['PaymentMethodInvoiceMode'];

export type VehicleCategoryCode = components['schemas']['VehicleCategory'];

export interface LocalRate {
  id: string;
  tenantId: string;
  name: string;
  hourPriceArs: string;
  stayPriceArs: string;
  fractionPriceArs: string;
  mediaEstadiaPriceArs: string;
  autoFractionPrice: boolean;
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
  rateSnapshotMediaEstadiaPriceArs?: string;
  cashSessionId?: string;
  ticketNumber?: number;
  /**
   * Checkbox «Facturada» de las playas sin ARCA. Opcional: el campo nació sin
   * bumpear `sync_seq`, así que una fila vieja no lo trae; `undefined` = no.
   */
  manuallyInvoiced?: boolean;
  /**
   * Tipo y categoría del vehículo, congelados al ingresar. Opcionales: los
   * ingresos anteriores a la v17 y los que mandó una caja vieja no los tienen,
   * y `vehicleTypeId` puede apuntar a un tipo ya borrado (sin FK en el server).
   */
  vehicleTypeId?: string;
  vehicleCategory?: VehicleCategoryCode;
  /** Nombre del tipo al momento del ingreso (snapshot). */
  vehicleType?: string;
  /**
   * Reserva con la que entró el auto y lo que ya pagó por Mercado Pago (v18).
   * Los escribe SIEMPRE el backend al crear el ingreso (por el banner o por
   * patente al sincronizar): un ingreso hecho sin conexión no los tiene hasta
   * que se pushea. Al salir se cobra `max(estadía − prepago, 0)`.
   */
  reservationId?: string;
  prepaidAmountArs?: string;
  version: number;
  syncSeq: number;
  updatedAt: string;
}

/**
 * Reserva de la playa vista desde la caja (v19): la sección "Reservas" (por
 * aceptar, hoy, próximas) y el panel "Reservas de hoy" del operativo leen de
 * acá. Es una FOTO de la última lectura online (`GET /reservations`), no un
 * feed: se reemplaza entera por playa en cada lectura y sin conexión se
 * muestra la última, marcada como desactualizada y SÓLO LECTURA.
 *
 * La caja nunca la edita offline: aceptar y rechazar mueven plata y tienen
 * plazo, así que no se encolan. Sólo se pisa una fila con la respuesta del
 * servidor después de una acción online, para que la lista cambie al toque.
 */
export interface LocalReservation {
  id: string;
  tenantId: string;
  code: string;
  status: components['schemas']['ReservationStatus'];
  vehiclePlate: string;
  vehicleCategory?: string;
  driverName?: string;
  entryAt: string;
  exitAt: string;
  totalArs: number;
  /** Hasta cuándo se puede aceptar o rechazar (`pending_approval`). */
  approvalDeadlineAt?: string;
  refundStatus: components['schemas']['OwnerReservationDto']['refundStatus'];
  refundedAmountArs?: number;
  /** Motivo de rechazo o cancelación (texto libre o código del sistema). */
  reason?: string;
  cancelledBy?: 'driver' | 'owner' | 'system';
  /** Cuándo entró el auto (checked_in / completed), del ingreso vinculado. */
  enteredAt?: string;
  /** El ingreso vinculado (fase 6c: el aviso "llegó antes" lo cruza con él). */
  stayEntryId?: string;
  /**
   * Cómo llegó el auto vinculado (fase 6c): antes de la ventana (dentro del
   * tope, "llegó antes"), a tiempo o tarde. Lo calcula el backend; un backend
   * anterior no lo manda. Sin índice: no hace falta subir la versión de Dexie.
   */
  arrival?: 'early' | 'on_time' | 'late';
  minutesEarly?: number;
  minutesLate?: number;
  /** Prepago descontado en la caja (snapshot del ingreso vinculado). */
  stayPrepaidArs?: number;
  /** Las reglas de la playa al reservar (detalle del modal "Reservas de hoy"). */
  policy?: components['schemas']['OwnerReservationPolicyDto'];
  /** Cuándo se leyó del servidor (ISO). */
  fetchedAt: string;
}

/**
 * Factura de ARCA de una estadía, tal como la manda `/invoices/changes`. La
 * crea y la emite el backend: el desktop sólo la lee (emitir y reintentar son
 * llamadas online). Alias del contrato generado, no una copia a mano.
 */
export type LocalInvoice = components['schemas']['InvoiceDto'];

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
  /**
   * El par id/nombre es un SNAPSHOT del medio con el que se cobró: el método
   * se puede renombrar o borrar, y el comprobante histórico tiene que seguir
   * diciendo lo que decía.
   */
  paymentMethodId?: string;
  paymentMethodName: string;
  /**
   * Tercer campo del mismo snapshot, y el que usa el arqueo (`isCashMethod`).
   *
   * OPCIONAL, aunque en el servidor la columna sea NOT NULL, y no es un
   * descuido: hay una ventana real en la que la fila local no lo tiene. El
   * upgrade a la v13 resetea el cursor de `paymentTransactions:` para que el
   * próximo pull rellene todo, pero entre el upgrade y ese pull —o si el
   * equipo está OFFLINE, que es el modo normal— las filas viejas siguen sin
   * tipo. `isCashMethod` cubre esa ventana con la regla vieja por nombre; el
   * tipo, cuando está, siempre gana.
   */
  paymentMethodType?: PaymentMethodKind;
  amount: number;
  version: number;
  syncSeq: number;
  updatedAt: string;
  deletedAt?: string;
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
  /**
   * Categoría de la plataforma a la que cuelga el tipo. Opcional por la ventana
   * de upgrade: la v17 resetea el cursor de `vehicleTypes:` y hasta que ese pull
   * entre, las filas viejas no la tienen.
   */
  category?: VehicleCategoryCode;
  /** Defensa: el pull borra los tombstones en vez de persistirlos. */
  deletedAt?: string;
  version: number;
  syncSeq: number;
  updatedAt: string;
  createdAt: string;
}

/** Fila de la lista cerrada de categorías. Se reemplaza entera en cada sync. */
export interface LocalVehicleCategory {
  code: VehicleCategoryCode;
  label: string;
  sortOrder: number;
  reservable: boolean;
}

export interface LocalPaymentMethod {
  id: string;
  tenantId: string;
  /**
   * Lo que el medio ES. `name` es cómo el dueño decidió llamarlo, y puede
   * cambiarlo cuando quiera; esto no.
   *
   * Es lo que el cobro copia al snapshot de la transacción para que el arqueo
   * no tenga que adivinar. Opcional por la misma ventana de upgrade que
   * `LocalPaymentTransaction.paymentMethodType`: la v13 resetea el cursor de
   * `paymentMethods:` y hasta que ese pull entre, las filas viejas no lo
   * tienen. Mismo precedente que la v6 con `isSystem`.
   */
  type?: PaymentMethodKind;
  name: string;
  enabled: boolean;
  isDefault: boolean;
  isSystem: boolean;
  /**
   * Si se factura al cobrar con este medio. Opcional: la columna nació sin
   * bumpear `sync_seq`, así que una fila vieja no lo trae hasta que el dueño
   * toque el medio (y ahí sí baja). `undefined` = no sabemos, no se promete
   * ninguna factura.
   */
  invoiceMode?: PaymentMethodInvoiceMode;
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

/** Recuadro de la patente en fracciones de la imagen (no en píxeles). */
export interface PlateBbox {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  plateBbox?: PlateBbox;
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

export type LocalLprIgnoredPlate = components['schemas']['LprIgnoredPlateDto'];

// 'unreviewed' is for audit-only ops (e.g. a freshly-detected LPR plate the
// operator hasn't registered/dismissed yet) — they still get pushed like any
// other op, but are excluded from the user-facing pending-changes count.
// 'conflict' es distinto de 'failed': la op es válida pero el servidor tiene una
// versión más nueva (409). Reintentar sola no la arregla, necesita una persona.
export type PendingOpStatus =
  | 'unreviewed'
  | 'pending'
  | 'in-flight'
  | 'conflict'
  | 'failed';
export type PendingOpEntity =
  | 'rate'
  | 'entry'
  | 'vehicle'
  | 'vehicleType'
  | 'lprIgnoredPlate'
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
  /**
   * Quién originó la operación. Se captura al ENCOLAR, no al pushear: en una
   * playa hay cambio de turno, y si el operador A dejó ops en la cola y entra
   * B, hay que poder decir de quién son.
   *
   * Ausente en las ops encoladas antes de la v12.
   */
  userId?: string;
  /** Epoch ms; no reintentar antes de este momento (backoff exponencial). */
  nextAttemptAt?: number;
}

class ParkitLocalDb extends Dexie {
  rates!: Table<LocalRate>;
  entries!: Table<LocalEntry>;
  vehicles!: Table<LocalVehicle>;
  vehicleTypes!: Table<LocalVehicleType>;
  lprIgnoredPlates!: Table<LocalLprIgnoredPlate>;
  vehicleCategories!: Table<LocalVehicleCategory>;
  paymentMethods!: Table<LocalPaymentMethod>;
  lprDetectionEvents!: Table<LocalLprDetectionEvent>;
  cashSessions!: Table<LocalCashSession>;
  paymentTransactions!: Table<LocalPaymentTransaction>;
  invoices!: Table<LocalInvoice>;
  reservations!: Table<LocalReservation>;
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

    // v12: la cola de pendientes deja de morirse en el primer 401.
    //
    // `failed` era un estado TERMINAL: `pushPendingOps` solo consultaba
    // 'pending' y 'unreviewed', así que una op que fallaba una vez no se
    // reintentaba NUNCA. Y al volver la conexión el sync salía con el access
    // token vencido (el evento `online` dispara al instante, el ticker de
    // supabase-js recién a los 30 s), así que TODA la cola del corte se
    // marcaba `failed` de una. El operador perdía el turno entero.
    //
    // Ahora el error se clasifica: lo recuperable vuelve a 'pending' con
    // `nextAttemptAt` (backoff), el 409 va a 'conflict', y solo el payload
    // inválido queda en 'failed'.
    this.version(12)
      .stores({
        pendingOps:
          '++localId, status, entityType, [tenantId+status], [tenantId+userId]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('pendingOps')
          .toCollection()
          .modify((op: PendingOp) => {
            // Las 'failed' cayeron por el bug de arriba, no porque su payload
            // fuera inválido (las de payload roto ya las borraron la v10 y la
            // v11). Merecen otra vuelta: si de verdad están mal, el nuevo
            // clasificador las manda a 'failed' y esta vez es de verdad.
            //
            // Las 'in-flight' son huérfanas: la app murió entre el marcado y
            // el resultado del push, y quedaron invisibles para el push Y para
            // el badge de pendientes. Pérdida silenciosa.
            if (op.status === 'failed' || op.status === 'in-flight') {
              op.status = 'pending';
              op.retryCount = 0;
              delete op.error;
              delete op.nextAttemptAt;
            }
          });
      });

    // v13: el arqueo de caja deja de adivinar el efectivo por el NOMBRE.
    //
    // `LocalPaymentMethod` gana `type` y `LocalPaymentTransaction` gana
    // `paymentMethodType` (el snapshot del tipo al cobrar). Ningún cambio de
    // índice: los dos se leen siempre después de traer la fila entera.
    //
    // Se resetean DOS cursores, y los dos hacen falta por razones distintas.
    //
    // 1. `paymentMethods:` — el feed es incremental por `sync_seq`, y agregar
    //    un campo al DTO no bumpea el `sync_seq` de nadie: el servidor no
    //    volvería a mencionar esas filas nunca. Sin el reset, un método ya
    //    sincronizado se queda sin `type` para siempre y el cobro no tiene qué
    //    snapshotear. Mismo patrón que la v6 con `isSystem` y la v10 con
    //    `version`.
    //
    // 2. `paymentTransactions:` — este es más sutil y es EL que evita que el
    //    bug siga vivo en las máquinas que ya estaban andando. La migración
    //    del backend (20260913200901) backfillea la columna con un UPDATE, que
    //    dispara el trigger y bumpea `sync_seq` de cada fila, así que en
    //    principio el pull incremental las volvería a bajar solas. Pero la
    //    ventana de deploy no es atómica:
    //
    //      a. se aplica la migración -> sync_seq bumpeado;
    //      b. el desktop, TODAVÍA con la app vieja, pulls: se baja las filas,
    //         las guarda con el mapper viejo (que no conoce el campo) y AVANZA
    //         EL CURSOR;
    //      c. recién ahí se actualiza la app.
    //
    //    Resultado: copia local sin tipo y cursor ya pasado. El servidor no
    //    tiene nada nuevo que contar y el arqueo de ese operador se queda sin
    //    efectivo. El reset fuerza el re-pull completo.
    //
    // No se toca `pendingOps` (a diferencia de la v10 y la v11): una op de
    // `entry` encolada lleva las líneas de pago SIN `paymentMethodType`, y el
    // backend la acepta igual — el campo es opcional a propósito y el servidor
    // resuelve el tipo por `paymentMethodId`. O sea: la cola del corte se
    // pushea bien y no hay que tirar el trabajo del operador.
    this.version(13)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' &&
              (s.key.startsWith('paymentMethods:') ||
                s.key.startsWith('paymentTransactions:')),
          )
          .delete();
      });

    this.version(14)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' &&
              (s.key.startsWith('rates:') || s.key.startsWith('entries:')),
          )
          .delete();
      });

    // v15: facturas de ARCA para el historial (estado, comprobante, CAE). Se
    // leen por estadía, así que van indexadas por `entryId`. Tabla nueva: el
    // primer pull las baja todas, no hace falta resetear ningún cursor.
    this.version(15).stores({
      invoices: 'id, [tenantId+syncSeq], tenantId, entryId',
    });
    this.version(16)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' &&
              s.key.startsWith('lprDetectionEvents:'),
          )
          .delete();
      });

    // v17: categorías de vehículo de la plataforma. Tabla nueva
    // (`vehicleCategories`, se reemplaza entera en cada sync) y campos nuevos
    // opcionales en tipos e ingresos.
    //
    // Se resetea SOLO el cursor `vehicleTypes:`: el backend subió `sync_seq` de
    // los tipos al completar `category`, pero una caja que ya estaba al día no
    // lo vería hasta el próximo cambio. No hace falta tocar `entries:` (los
    // ingresos viejos quedan sin categoría, igual que en el servidor) ni
    // `pendingOps` (todos los campos nuevos son opcionales: las ops encoladas,
    // incluidos los tipos sin `category`, siguen siendo válidas).
    this.version(17)
      .stores({ vehicleCategories: 'code' })
      .upgrade(async (tx) => {
        await tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' && s.key.startsWith('vehicleTypes:'),
          )
          .delete();
      });

    // v18: reservas en la caja (fase 6).
    //
    // `LocalEntry` gana `reservationId` y `prepaidAmountArs` (sin índice: se
    // leen con la fila entera) y aparece `todayReservations`, la foto del
    // panel "Reservas de hoy" (se reemplaza entera, no tiene cursor).
    //
    // Se resetea el cursor `entries:`, por el mismo agujero que la v13 con
    // `paymentTransactions:`: el deploy no es atómico. Entre el deploy del
    // backend y la actualización de esta app, la versión vieja baja (o crea)
    // ingresos ya vinculados a una reserva, los guarda con el mapper viejo
    // —sin el prepago— y AVANZA EL CURSOR. Si ese auto sale después de
    // actualizar, la caja no sabría que ya pagó y le cobraría la estadía
    // entera. El re-pull rellena los campos (el pull ahora pagina, así que se
    // pone al día en una vuelta).
    //
    // No se toca `pendingOps`: `reservationId` es opcional y las ops de
    // ingreso encoladas siguen siendo válidas (el backend vincula por patente).
    this.version(18)
      .stores({ todayReservations: 'id, tenantId' })
      .upgrade(async (tx) => {
        await tx
          .table('syncState')
          .toCollection()
          .filter(
            (s: SyncState) =>
              typeof s.key === 'string' && s.key.startsWith('entries:'),
          )
          .delete();
      });

    // v19: la caja acepta y rechaza reservas (fase 6b).
    //
    // `todayReservations` (sólo las de hoy, con lo justo para el panel) se
    // reemplaza por `reservations`: la foto de todo lo que le importa a la caja
    // (por aceptar con su plazo, hoy y próximas, con el estado del reembolso).
    // No se migra nada: es una foto descartable que la próxima lectura online
    // vuelve a llenar, y sin conexión el panel queda vacío hasta reconectar.
    this.version(19).stores({
      todayReservations: null,
      reservations: 'id, tenantId',
    });
    this.version(20).stores({
      lprIgnoredPlates: 'id, tenantId, [tenantId+plate]',
    });
  }
}

export const localDb = new ParkitLocalDb();
