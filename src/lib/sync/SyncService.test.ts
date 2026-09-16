import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryChangesResponseDto, EntryDto } from '../api/entries';
import type { LprDetectionEventDto } from '../api/lpr-events';
import type { PaymentMethodDto } from '../api/payment-methods';
import type { RateDto } from '../api/rates';
import type { VehicleTypeDto } from '../api/vehicle-types';
import type { VehicleDto } from '../api/vehicles';
import type {
  LocalEntry,
  LocalLprDetectionEvent,
  LocalPaymentMethod,
  LocalRate,
  LocalVehicle,
  LocalVehicleType,
  PendingOp,
  PendingOpEntity,
  SyncState,
} from '../db/localDb';

const TENANT = 'tenant-1';
const TOKEN = 'token-abc';
const STATE_KEY = `entries:${TENANT}`;

/**
 * Dexie mínimo en memoria. No hay IndexedDB en el runner (vitest corre en node
 * sin `environment`), así que el `localDb` real ni siquiera puede abrirse: lo
 * que se testea es la decisión de cada `pullX`, no Dexie.
 */
const h = vi.hoisted(() => {
  /**
   * Tabla Dexie de mentira. Solo lo que usan los pulls: `bulkPut`, `bulkDelete`
   * y `bulkGet` (que devuelve `undefined` en los huecos, igual que Dexie — de
   * eso depende la preservación de campos de `pullLprDetectionEvents`).
   */
  function makeTable<T extends { id: string }>() {
    const rows = new Map<string, T>();
    return {
      rows,
      bulkPut(items: T[]): Promise<void> {
        for (const row of items) rows.set(row.id, row);
        return Promise.resolve();
      },
      bulkDelete(ids: string[]): Promise<void> {
        for (const id of ids) rows.delete(id);
        return Promise.resolve();
      },
      bulkGet(ids: string[]): Promise<(T | undefined)[]> {
        return Promise.resolve(ids.map((id) => rows.get(id)));
      },
    };
  }

  const entries = new Map<string, LocalEntry>();
  const syncState = new Map<string, SyncState>();
  const pendingOps: PendingOp[] = [];
  const rates = makeTable<LocalRate>();
  const vehicles = makeTable<LocalVehicle>();
  const vehicleTypes = makeTable<LocalVehicleType>();
  const paymentMethods = makeTable<LocalPaymentMethod>();
  const lprDetectionEvents = makeTable<LocalLprDetectionEvent>();

  const localDb = {
    entries: {
      bulkPut(rows: LocalEntry[]): Promise<void> {
        for (const row of rows) entries.set(row.id, row);
        return Promise.resolve();
      },
    },
    rates,
    vehicles,
    vehicleTypes,
    paymentMethods,
    lprDetectionEvents,
    syncState: {
      get(key: string): Promise<SyncState | undefined> {
        return Promise.resolve(syncState.get(key));
      },
      put(row: SyncState): Promise<void> {
        syncState.set(row.key, row);
        return Promise.resolve();
      },
    },
    pendingOps: {
      where() {
        return {
          // `anyOf([[tenantId, status], ...])` sobre el índice compuesto.
          anyOf(keys: string[][]) {
            return {
              toArray(): Promise<PendingOp[]> {
                return Promise.resolve(
                  pendingOps.filter((op) =>
                    keys.some(
                      ([tenantId, status]) =>
                        op.tenantId === tenantId && op.status === status,
                    ),
                  ),
                );
              },
            };
          },
        };
      },
    },
    // El scope de tablas no importa acá: se ejecuta el cuerpo y listo.
    transaction(_mode: string, ...rest: unknown[]): Promise<void> {
      const body = rest[rest.length - 1] as () => Promise<void>;
      return body();
    },
  };

  const pullEntryChanges = vi.fn(
    (input: {
      tenantId: string;
      bearer: string;
      query?: { afterSeq?: number; limit?: number };
    }): Promise<EntryChangesResponseDto> =>
      // Default inocuo: página vacía que deja el cursor donde estaba.
      Promise.resolve({ items: [], maxSeq: input.query?.afterSeq ?? 0 }),
  );

  /** Mismo default inocuo, para el resto de los feeds. */
  function changesMock<T>() {
    return vi.fn(
      (input: {
        tenantId: string;
        bearer: string;
        query?: { afterSeq?: number; limit?: number };
      }): Promise<{ items: T[]; maxSeq: number }> =>
        Promise.resolve({ items: [], maxSeq: input.query?.afterSeq ?? 0 }),
    );
  }

  return {
    entries,
    syncState,
    pendingOps,
    rates,
    vehicles,
    vehicleTypes,
    paymentMethods,
    lprDetectionEvents,
    localDb,
    pullEntryChanges,
    pullRateChanges: changesMock<RateDto>(),
    pullVehicleChanges: changesMock<VehicleDto>(),
    pullVehicleTypeChanges: changesMock<VehicleTypeDto>(),
    pullPaymentMethodChanges: changesMock<PaymentMethodDto>(),
    pullLprDetectionEventChanges: changesMock<LprDetectionEventDto>(),
  };
});

vi.mock('../db/localDb', () => ({ localDb: h.localDb }));
vi.mock('../api/entries', () => ({
  pullEntryChanges: h.pullEntryChanges,
  createEntry: vi.fn(),
  closeEntry: vi.fn(),
  correctEntry: vi.fn(),
}));
// Del resto de los módulos HTTP solo se reemplaza el pull: `importOriginal`
// deja pasar las demás exports tal cual, así que agregar una función al módulo
// no rompe este mock.
vi.mock('../api/rates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/rates')>()),
  pullRateChanges: h.pullRateChanges,
}));
vi.mock('../api/vehicles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/vehicles')>()),
  pullVehicleChanges: h.pullVehicleChanges,
}));
vi.mock('../api/vehicle-types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/vehicle-types')>()),
  pullVehicleTypeChanges: h.pullVehicleTypeChanges,
}));
vi.mock('../api/payment-methods', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/payment-methods')>()),
  pullPaymentMethodChanges: h.pullPaymentMethodChanges,
}));
vi.mock('../api/lpr-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/lpr-events')>()),
  pullLprDetectionEventChanges: h.pullLprDetectionEventChanges,
}));

const { syncService } = await import('./SyncService');

const ENTERED_AT = '2026-09-13T10:00:00.000Z';
const LEFT_AT = '2026-09-13T12:30:00.000Z';

function serverEntry(id: string, overrides: Partial<EntryDto> = {}): EntryDto {
  return {
    id,
    tenantId: TENANT,
    plate: 'ABC123',
    source: 'manual',
    enteredAt: ENTERED_AT,
    version: 1,
    syncSeq: 1,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function localEntry(
  id: string,
  overrides: Partial<LocalEntry> = {},
): LocalEntry {
  return {
    id,
    tenantId: TENANT,
    plate: 'ABC123',
    enteredAt: ENTERED_AT,
    version: 1,
    syncSeq: 1,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function queueOp(
  entityType: PendingOpEntity,
  entityId: string,
  status: PendingOp['status'] = 'pending',
): void {
  h.pendingOps.push({
    localId: h.pendingOps.length + 1,
    entityType,
    operation: 'update',
    tenantId: TENANT,
    entityId,
    payload: { expectedVersion: 3, body: {} },
    status,
    createdAt: Date.now(),
    retryCount: 0,
  });
}

function queueEntryOp(entityId: string, status: PendingOp['status']): void {
  queueOp('entry', entityId, status);
}

/** La estadía que el operador ya cerró y cobró en este equipo. */
function closedLocally(id: string): LocalEntry {
  return localEntry(id, {
    leftAt: LEFT_AT,
    amountPaid: '5000',
    version: 3,
    syncSeq: 4,
    updatedAt: LEFT_AT,
  });
}

/** La foto vieja que sigue mandando el servidor: el auto todavía adentro. */
function stillOpenOnServer(id: string): EntryDto {
  return serverEntry(id, { version: 4, syncSeq: 9, updatedAt: LEFT_AT });
}

beforeEach(() => {
  h.entries.clear();
  h.syncState.clear();
  h.pendingOps.length = 0;
  h.rates.rows.clear();
  h.vehicles.rows.clear();
  h.vehicleTypes.rows.clear();
  h.paymentMethods.rows.clear();
  h.lprDetectionEvents.rows.clear();
  // `mockReset` devuelve la implementación original (la página vacía), no la
  // borra: es el cambio de comportamiento de Vitest 2.
  h.pullEntryChanges.mockReset();
  h.pullRateChanges.mockReset();
  h.pullVehicleChanges.mockReset();
  h.pullVehicleTypeChanges.mockReset();
  h.pullPaymentMethodChanges.mockReset();
  h.pullLprDetectionEventChanges.mockReset();
  syncService.setCredentials(TENANT, TOKEN);
});

describe('pullEntries y los cambios locales sin sincronizar', () => {
  it('no pisa una entry que tiene una op encolada', async () => {
    // ESTE es el bug. `ExitModal` escribe `leftAt` y `amountPaid` en local y
    // encola la op; hasta que el push salga, el feed del servidor sigue
    // devolviendo la estadía abierta. El `bulkPut` sin filtrar revertía el
    // cobro y el auto volvía a figurar adentro — pérdida de datos silenciosa.
    h.entries.set('e-1', closedLocally('e-1'));
    queueEntryOp('e-1', 'pending');

    h.pullEntryChanges.mockResolvedValue({
      items: [stillOpenOnServer('e-1')],
      maxSeq: 9,
    });

    await syncService.pullEntries();

    expect(h.entries.get('e-1')).toMatchObject({
      leftAt: LEFT_AT,
      amountPaid: '5000',
      version: 3,
    });
  });

  it('sí escribe las entries limpias de la misma página', async () => {
    // El filtro es por fila, no por página: saltear la página entera dejaría
    // sin sincronizar todo lo que no tiene nada que ver.
    h.entries.set('e-1', closedLocally('e-1'));
    queueEntryOp('e-1', 'pending');

    h.pullEntryChanges.mockResolvedValue({
      items: [
        stillOpenOnServer('e-1'),
        serverEntry('e-2', { plate: 'ZZZ999', syncSeq: 10 }),
      ],
      maxSeq: 10,
    });

    await syncService.pullEntries();

    expect(h.entries.get('e-1')?.leftAt).toBe(LEFT_AT);
    expect(h.entries.get('e-2')).toMatchObject({ plate: 'ZZZ999' });
  });

  it.each(['unreviewed', 'in-flight', 'conflict', 'failed'] as const)(
    'también protege la entry con una op en estado %s',
    async (status) => {
      // `locallyDirtyIds` cubre todos los estados no terminados con éxito: una
      // op en 'conflict' o 'failed' sigue siendo trabajo del operador que nadie
      // resolvió todavía, y pisarla lo borra sin que se entere.
      h.entries.set('e-1', closedLocally('e-1'));
      queueEntryOp('e-1', status);

      h.pullEntryChanges.mockResolvedValue({
        items: [stillOpenOnServer('e-1')],
        maxSeq: 9,
      });

      await syncService.pullEntries();

      expect(h.entries.get('e-1')?.leftAt).toBe(LEFT_AT);
    },
  );

  it('ignora las ops de otras entidades y de otros tenants', async () => {
    h.entries.set('e-1', closedLocally('e-1'));
    h.pendingOps.push({
      localId: 1,
      entityType: 'cashSession',
      operation: 'update',
      tenantId: TENANT,
      entityId: 'e-1',
      payload: {},
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
    });
    h.pendingOps.push({
      localId: 2,
      entityType: 'entry',
      operation: 'update',
      tenantId: 'otro-tenant',
      entityId: 'e-1',
      payload: {},
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
    });

    h.pullEntryChanges.mockResolvedValue({
      items: [stillOpenOnServer('e-1')],
      maxSeq: 9,
    });

    await syncService.pullEntries();

    // Nada de eso hace `dirty` a la entry: el servidor manda.
    expect(h.entries.get('e-1')?.leftAt).toBeUndefined();
    expect(h.entries.get('e-1')?.version).toBe(4);
  });

  it('sin ops encoladas el servidor sigue siendo la autoridad', async () => {
    h.entries.set('e-1', localEntry('e-1', { plate: 'VIEJA11' }));

    h.pullEntryChanges.mockResolvedValue({
      items: [serverEntry('e-1', { plate: 'NUEVA22', version: 2, syncSeq: 7 })],
      maxSeq: 7,
    });

    await syncService.pullEntries();

    expect(h.entries.get('e-1')).toMatchObject({
      plate: 'NUEVA22',
      version: 2,
    });
  });
});

describe('pullEntries y el cursor', () => {
  it('arranca desde el `lastSeq` guardado', async () => {
    h.syncState.set(STATE_KEY, {
      key: STATE_KEY,
      lastSeq: 42,
      lastSyncAt: ENTERED_AT,
    });
    h.pullEntryChanges.mockResolvedValue({ items: [], maxSeq: 42 });

    await syncService.pullEntries();

    expect(h.pullEntryChanges).toHaveBeenCalledWith(
      expect.objectContaining({ query: { afterSeq: 42 } }),
    );
  });

  it('avanza igual aunque haya salteado una fila', async () => {
    // Decisión deliberada, calcada de `pullCashSessions`: frenar el cursor
    // haría re-descargar la página entera en cada sync mientras exista
    // cualquier op pendiente. La fila salteada se repara cuando
    // `drainPendingOps` pushea la op y escribe la respuesta del servidor.
    //
    // La contracara está documentada en `locallyDirtyIds`: una op que muere en
    // 'conflict'/'failed' deja esa fila salteada para siempre con el cursor ya
    // pasado. Es un agujero conocido de TODOS los `pullX` que usan el filtro,
    // no algo que introduzca este cambio.
    h.entries.set('e-1', closedLocally('e-1'));
    queueEntryOp('e-1', 'pending');

    h.pullEntryChanges.mockResolvedValue({
      items: [stillOpenOnServer('e-1')],
      maxSeq: 9,
    });

    await syncService.pullEntries();

    expect(h.syncState.get(STATE_KEY)?.lastSeq).toBe(9);
  });

  it('con una página vacía deja el cursor donde estaba', async () => {
    h.syncState.set(STATE_KEY, {
      key: STATE_KEY,
      lastSeq: 42,
      lastSyncAt: ENTERED_AT,
    });
    h.pullEntryChanges.mockResolvedValue({ items: [], maxSeq: 0 });

    await syncService.pullEntries();

    expect(h.syncState.get(STATE_KEY)?.lastSeq).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// El mismo bug que tenía `pullEntries` vivía en los otros cinco feeds: el
// `bulkPut` escribía la página entera sin mirar la cola. Un caso de regresión
// por pull, con la misma forma: una fila sucia y una limpia en la MISMA página,
// para que se vea que el filtro es por fila y no por página.
// ---------------------------------------------------------------------------

function serverRate(id: string, overrides: Partial<RateDto> = {}): RateDto {
  return {
    id,
    tenantId: TENANT,
    name: 'Auto',
    hourPriceArs: 1000,
    stayPriceArs: 5000,
    fractionPriceArs: 500,
    mediaEstadiaPriceArs: 2500,
    autoFractionPrice: false,
    isActive: true,
    shortcutNumber: null,
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function localRate(id: string, overrides: Partial<LocalRate> = {}): LocalRate {
  return {
    id,
    tenantId: TENANT,
    name: 'Auto',
    hourPriceArs: '1000',
    stayPriceArs: '5000',
    fractionPriceArs: '500',
    mediaEstadiaPriceArs: '2500',
    autoFractionPrice: false,
    isActive: true,
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function serverVehicleType(
  id: string,
  overrides: Partial<VehicleTypeDto> = {},
): VehicleTypeDto {
  return {
    id,
    tenantId: TENANT,
    name: 'Auto',
    accepted: true,
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function localVehicleType(
  id: string,
  overrides: Partial<LocalVehicleType> = {},
): LocalVehicleType {
  return {
    id,
    tenantId: TENANT,
    name: 'Auto',
    accepted: true,
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function serverVehicle(
  id: string,
  overrides: Partial<VehicleDto> = {},
): VehicleDto {
  return {
    id,
    tenantId: TENANT,
    brand: 'Fiat',
    model: 'Cronos',
    typeId: 'type-1',
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function localVehicle(
  id: string,
  overrides: Partial<LocalVehicle> = {},
): LocalVehicle {
  return {
    id,
    tenantId: TENANT,
    brand: 'Fiat',
    model: 'Cronos',
    typeId: 'type-1',
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function serverPaymentMethod(
  id: string,
  overrides: Partial<PaymentMethodDto> = {},
): PaymentMethodDto {
  return {
    id,
    type: 'cash',
    name: 'Efectivo',
    enabled: true,
    isDefault: false,
    isSystem: false,
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function localPaymentMethod(
  id: string,
  overrides: Partial<LocalPaymentMethod> = {},
): LocalPaymentMethod {
  return {
    id,
    tenantId: TENANT,
    type: 'cash',
    name: 'Efectivo',
    enabled: true,
    isDefault: false,
    isSystem: false,
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

describe('pullRates y los cambios locales sin sincronizar', () => {
  it('no pisa una tarifa con una op encolada', async () => {
    // El operador subió el precio sin red. El feed sigue trayendo el viejo:
    // pisarlo lo hace cobrar de menos todo el turno, sin ningún aviso.
    h.rates.rows.set('r-1', localRate('r-1', { hourPriceArs: '1500' }));
    queueOp('rate', 'r-1');

    h.pullRateChanges.mockResolvedValue({
      items: [
        serverRate('r-1', { hourPriceArs: 1000, version: 2, syncSeq: 8 }),
        serverRate('r-2', { name: 'Moto', syncSeq: 9 }),
      ],
      maxSeq: 9,
    });

    await syncService.pullRates();

    expect(h.rates.rows.get('r-1')?.hourPriceArs).toBe('1500');
    expect(h.rates.rows.get('r-2')).toMatchObject({ name: 'Moto' });
  });

  it('borra igual el tombstone aunque la tarifa tenga una op encolada', async () => {
    // Decisión deliberada: el filtro es solo para el `bulkPut`. Una baja es una
    // afirmación del servidor, no una foto vieja, y una tarifa borrada que
    // sobrevive en local se sigue pudiendo cobrar.
    h.rates.rows.set('r-1', localRate('r-1', { hourPriceArs: '1500' }));
    queueOp('rate', 'r-1');

    h.pullRateChanges.mockResolvedValue({
      items: [
        serverRate('r-1', { deletedAt: LEFT_AT, version: 2, syncSeq: 8 }),
      ],
      maxSeq: 8,
    });

    await syncService.pullRates();

    expect(h.rates.rows.has('r-1')).toBe(false);
  });
});

describe('pullVehicleTypes y los cambios locales sin sincronizar', () => {
  it('no pisa un tipo de vehículo con una op encolada', async () => {
    h.vehicleTypes.rows.set(
      't-1',
      localVehicleType('t-1', { name: 'Camioneta', accepted: false }),
    );
    queueOp('vehicleType', 't-1');

    h.pullVehicleTypeChanges.mockResolvedValue({
      items: [
        serverVehicleType('t-1', { name: 'Auto', version: 2, syncSeq: 8 }),
        serverVehicleType('t-2', { name: 'Moto', syncSeq: 9 }),
      ],
      maxSeq: 9,
    });

    await syncService.pullVehicleTypes();

    expect(h.vehicleTypes.rows.get('t-1')).toMatchObject({
      name: 'Camioneta',
      accepted: false,
    });
    expect(h.vehicleTypes.rows.get('t-2')).toMatchObject({ name: 'Moto' });
  });
});

describe('pullVehicles y los cambios locales sin sincronizar', () => {
  it('no pisa un vehículo con una op encolada', async () => {
    h.vehicles.rows.set('v-1', localVehicle('v-1', { model: 'Toro' }));
    queueOp('vehicle', 'v-1');

    h.pullVehicleChanges.mockResolvedValue({
      items: [
        serverVehicle('v-1', { model: 'Cronos', version: 2, syncSeq: 8 }),
        serverVehicle('v-2', { model: 'Argo', syncSeq: 9 }),
      ],
      maxSeq: 9,
    });

    await syncService.pullVehicles();

    expect(h.vehicles.rows.get('v-1')?.model).toBe('Toro');
    expect(h.vehicles.rows.get('v-2')).toMatchObject({ model: 'Argo' });
  });
});

describe('pullPaymentMethods y los cambios locales sin sincronizar', () => {
  it('no pisa un medio de pago con una op encolada', async () => {
    // Apagar un medio de pago es una decisión operativa: si el pull lo vuelve a
    // encender, el operador cobra por una vía que ya había cerrado.
    h.paymentMethods.rows.set(
      'pm-1',
      localPaymentMethod('pm-1', { enabled: false }),
    );
    queueOp('paymentMethod', 'pm-1');

    h.pullPaymentMethodChanges.mockResolvedValue({
      items: [
        serverPaymentMethod('pm-1', {
          enabled: true,
          version: 2,
          syncSeq: 8,
        }),
        serverPaymentMethod('pm-2', { name: 'QR', syncSeq: 9 }),
      ],
      maxSeq: 9,
    });

    await syncService.pullPaymentMethods();

    expect(h.paymentMethods.rows.get('pm-1')?.enabled).toBe(false);
    expect(h.paymentMethods.rows.get('pm-2')).toMatchObject({
      name: 'QR',
      tenantId: TENANT,
    });
  });

  it('baja el `type`, que es lo que el cobro snapshotea para el arqueo', async () => {
    // Sin este campo en la copia local, `ExitModal` no tiene qué copiar a la
    // transacción y el arqueo vuelve a tener que deducir el efectivo del
    // nombre. Ojo a los nombres del fixture: uno es 'cash' y se llama "Caja",
    // el otro es 'other' y se llama "Efectivo Mercado Pago". Si esto se
    // mapeara por nombre, los dos saldrían al revés.
    h.pullPaymentMethodChanges.mockResolvedValue({
      items: [
        serverPaymentMethod('pm-cash', {
          type: 'cash',
          name: 'Caja',
          syncSeq: 3,
        }),
        serverPaymentMethod('pm-mp', {
          type: 'other',
          name: 'Efectivo Mercado Pago',
          syncSeq: 4,
        }),
      ],
      maxSeq: 4,
    });

    await syncService.pullPaymentMethods();

    expect(h.paymentMethods.rows.get('pm-cash')?.type).toBe('cash');
    expect(h.paymentMethods.rows.get('pm-mp')?.type).toBe('other');
  });
});

function serverLprEvent(
  id: string,
  overrides: Partial<LprDetectionEventDto> = {},
): LprDetectionEventDto {
  return {
    id,
    tenantId: TENANT,
    cameraId: 'cam-1',
    location: 'entrada',
    firstSeenAt: ENTERED_AT,
    lastSeenAt: ENTERED_AT,
    confidence: 0.9,
    formatValid: true,
    formatType: 'argentina_mercosur',
    qualityStatus: 'valid_high',
    status: 'pending',
    candidates: [],
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

function localLprEvent(
  id: string,
  overrides: Partial<LocalLprDetectionEvent> = {},
): LocalLprDetectionEvent {
  return {
    id,
    tenantId: TENANT,
    cameraId: 'cam-1',
    location: 'entrada',
    firstSeenAt: ENTERED_AT,
    lastSeenAt: ENTERED_AT,
    confidence: 0.9,
    formatValid: true,
    formatType: 'argentina_mercosur',
    qualityStatus: 'valid_high',
    status: 'pending',
    candidates: [],
    version: 1,
    syncSeq: 1,
    createdAt: ENTERED_AT,
    updatedAt: ENTERED_AT,
    ...overrides,
  };
}

describe('pullLprDetectionEvents y los cambios locales sin sincronizar', () => {
  it('no pisa la decisión del operador mientras la op sigue encolada', async () => {
    // La mitigación que ya existía (preservar campos con `bulkGet`) salvaba lo
    // que calculó el OCR y pisaba lo que decidió la PERSONA: `status`,
    // `entryId` y `reviewedAt` no estaban en la lista. Registrar una detección
    // sin red y comerse un pull la devolvía a 'pending' y la patente
    // reaparecía en la cola de revisión.
    h.lprDetectionEvents.rows.set(
      'lpr-1',
      localLprEvent('lpr-1', {
        status: 'registered',
        entryId: 'entry-9',
        reviewedAt: LEFT_AT,
        version: 2,
      }),
    );
    queueOp('lprDetectionEvent', 'lpr-1');

    h.pullLprDetectionEventChanges.mockResolvedValue({
      items: [
        serverLprEvent('lpr-1', { status: 'pending', version: 3, syncSeq: 8 }),
        serverLprEvent('lpr-2', { syncSeq: 9 }),
      ],
      maxSeq: 9,
    });

    await syncService.pullLprDetectionEvents();

    expect(h.lprDetectionEvents.rows.get('lpr-1')).toMatchObject({
      status: 'registered',
      entryId: 'entry-9',
      reviewedAt: LEFT_AT,
      version: 2,
    });
    expect(h.lprDetectionEvents.rows.get('lpr-2')?.syncSeq).toBe(9);
  });

  it('sigue preservando los campos del OCR en una fila sin op encolada', async () => {
    // El filtro NO reemplaza a la preservación de campos: apenas la op drena,
    // la fila vuelve a quedar expuesta, y el feed no trae `bestCaptureId` ni
    // las candidatas (viven en el disco de esta máquina).
    h.lprDetectionEvents.rows.set(
      'lpr-1',
      localLprEvent('lpr-1', {
        rawText: 'AB 123 CD',
        displayPlate: 'AB123CD',
        bestCaptureId: 'cap-1',
        candidates: [{ plate: 'AB123CD' }],
      }),
    );

    h.pullLprDetectionEventChanges.mockResolvedValue({
      items: [
        serverLprEvent('lpr-1', {
          rawText: null,
          displayPlate: null,
          bestCaptureId: null,
          candidates: [],
          status: 'dismissed',
          version: 2,
          syncSeq: 8,
        }),
      ],
      maxSeq: 8,
    });

    await syncService.pullLprDetectionEvents();

    expect(h.lprDetectionEvents.rows.get('lpr-1')).toMatchObject({
      rawText: 'AB 123 CD',
      displayPlate: 'AB123CD',
      bestCaptureId: 'cap-1',
      candidates: [{ plate: 'AB123CD' }],
      // Sin op encolada el servidor manda, también sobre la decisión.
      status: 'dismissed',
      version: 2,
    });
  });

  it('aparea cada evento con su propia fila local aunque la página traiga uno salteado', async () => {
    // Trampa de índices: `existingRows` del `bulkGet` se indexa por POSICIÓN.
    // Si el filtro corriera después del `bulkGet`, el segundo evento heredaría
    // la captura del primero — mezclaría la foto de una patente con otra.
    h.lprDetectionEvents.rows.set(
      'lpr-1',
      localLprEvent('lpr-1', { status: 'registered', bestCaptureId: 'cap-1' }),
    );
    h.lprDetectionEvents.rows.set(
      'lpr-2',
      localLprEvent('lpr-2', { bestCaptureId: 'cap-2' }),
    );
    queueOp('lprDetectionEvent', 'lpr-1');

    h.pullLprDetectionEventChanges.mockResolvedValue({
      items: [
        serverLprEvent('lpr-1', { bestCaptureId: null, syncSeq: 8 }),
        serverLprEvent('lpr-2', { bestCaptureId: null, syncSeq: 9 }),
      ],
      maxSeq: 9,
    });

    await syncService.pullLprDetectionEvents();

    expect(h.lprDetectionEvents.rows.get('lpr-2')?.bestCaptureId).toBe('cap-2');
  });
});
