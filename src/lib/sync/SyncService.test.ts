import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntryChangesResponseDto, EntryDto } from '../api/entries';
import type { LprDetectionEventDto } from '../api/lpr-events';
import type { PaymentMethodDto } from '../api/payment-methods';
import type { RateDto } from '../api/rates';
import type { VehicleTypeDto } from '../api/vehicle-types';
import type { VehicleDto } from '../api/vehicles';
import type {
  LocalEntry,
  LocalInvoice,
  LocalLprDetectionEvent,
  LocalPaymentMethod,
  LocalRate,
  LocalVehicle,
  LocalVehicleCategory,
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
      put(row: T): Promise<void> {
        rows.set(row.id, row);
        return Promise.resolve();
      },
      // `where('tenantId').equals(...).filter(...).toArray()`, que es como
      // `pushLprDetectionEventImages` elige qué imágenes faltan subir.
      where(field: keyof T & string) {
        return {
          equals(value: unknown) {
            const matching = () =>
              [...rows.values()].filter((row) => row[field] === value);
            return {
              toArray: () => Promise.resolve(matching()),
              filter(predicate: (row: T) => boolean) {
                return {
                  toArray: () => Promise.resolve(matching().filter(predicate)),
                };
              },
            };
          },
        };
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
  const invoices = makeTable<LocalInvoice>();

  // Tabla keyed por `code` (no por `id`): sólo lo que usa pullVehicleCategories.
  const vehicleCategories = new Map<string, LocalVehicleCategory>();
  const vehicleCategoriesTable = {
    clear(): Promise<void> {
      vehicleCategories.clear();
      return Promise.resolve();
    },
    bulkPut(items: LocalVehicleCategory[]): Promise<void> {
      for (const c of items) vehicleCategories.set(c.code, c);
      return Promise.resolve();
    },
  };

  const localDb = {
    vehicleCategories: vehicleCategoriesTable,
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
    invoices,
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
    vehicleCategories,
    paymentMethods,
    lprDetectionEvents,
    invoices,
    localDb,
    listVehicleCategories: vi.fn(),
    pullEntryChanges,
    pullInvoiceChanges: vi.fn(
      (input: {
        afterSeq: number;
      }): Promise<{ items: LocalInvoice[]; maxSeq: number }> =>
        Promise.resolve({ items: [], maxSeq: input.afterSeq }),
    ),
    pullRateChanges: changesMock<RateDto>(),
    listRates: vi.fn(),
    listVehicleTypes: vi.fn(),
    listPaymentMethods: vi.fn(),
    pullVehicleChanges: changesMock<VehicleDto>(),
    pullVehicleTypeChanges: changesMock<VehicleTypeDto>(),
    pullPaymentMethodChanges: changesMock<PaymentMethodDto>(),
    pullLprDetectionEventChanges: changesMock<LprDetectionEventDto>(),
    uploadLprDetectionEventImage: vi.fn(),
  };
});

import { ApiError } from '../api/client';

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
  listRates: h.listRates,
}));
vi.mock('../api/vehicles', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/vehicles')>()),
  pullVehicleChanges: h.pullVehicleChanges,
}));
vi.mock('../api/vehicle-types', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/vehicle-types')>()),
  pullVehicleTypeChanges: h.pullVehicleTypeChanges,
  listVehicleTypes: h.listVehicleTypes,
}));
vi.mock('../api/vehicle-categories', () => ({
  listVehicleCategories: h.listVehicleCategories,
}));
vi.mock('../api/payment-methods', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/payment-methods')>()),
  pullPaymentMethodChanges: h.pullPaymentMethodChanges,
  listPaymentMethods: h.listPaymentMethods,
}));
vi.mock('../api/arca', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/arca')>()),
  pullInvoiceChanges: h.pullInvoiceChanges,
}));
vi.mock('../api/lpr-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/lpr-events')>()),
  pullLprDetectionEventChanges: h.pullLprDetectionEventChanges,
  uploadLprDetectionEventImage: h.uploadLprDetectionEventImage,
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
    manuallyInvoiced: false,
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
  h.vehicleCategories.clear();
  h.listVehicleCategories.mockReset();
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
  h.listRates.mockReset();
  h.listVehicleTypes.mockReset();
  h.listPaymentMethods.mockReset();
  h.uploadLprDetectionEventImage.mockReset();
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
      expect.objectContaining({ query: { afterSeq: 42, limit: 500 } }),
    );
  });

  it('pagina hasta la última página incompleta (cursor reseteado por un upgrade)', async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) =>
        serverEntry(`e-${from + i}`, { syncSeq: from + i }),
      );
    h.pullEntryChanges
      .mockResolvedValueOnce({ items: page(1, 500), maxSeq: 500 })
      .mockResolvedValueOnce({ items: page(501, 3), maxSeq: 503 });

    await syncService.pullEntries();

    expect(h.pullEntryChanges).toHaveBeenCalledTimes(2);
    expect(h.pullEntryChanges).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: { afterSeq: 500, limit: 500 } }),
    );
    expect(h.syncState.get(STATE_KEY)?.lastSeq).toBe(503);
    expect(h.entries.size).toBe(503);
  });

  it('baja la reserva vinculada y el prepago del ingreso', async () => {
    h.pullEntryChanges.mockResolvedValue({
      items: [
        serverEntry('e-res', {
          reservationId: 'res-1',
          prepaidAmountArs: 4500,
        }),
        // Un backend anterior a la fase 6 no los manda.
        serverEntry('e-old'),
      ],
      maxSeq: 2,
    });

    await syncService.pullEntries();

    expect(h.entries.get('e-res')).toMatchObject({
      reservationId: 'res-1',
      prepaidAmountArs: '4500',
    });
    expect(h.entries.get('e-old')?.reservationId).toBeUndefined();
    expect(h.entries.get('e-old')?.prepaidAmountArs).toBeUndefined();
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
    category: 'car',
    categoryInferred: false,
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
    invoiceMode: 'none',
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

describe('pullVehicleCategories', () => {
  const car = { code: 'car', label: 'Auto', sortOrder: 1, reservable: true };
  const bike = {
    code: 'bicycle',
    label: 'Bici',
    sortOrder: 6,
    reservable: false,
  };

  it('reemplaza la lista entera: lo que ya no viene se borra', async () => {
    h.vehicleCategories.set('truck', {
      code: 'truck',
      label: 'Camión',
      sortOrder: 7,
      reservable: false,
    });
    h.listVehicleCategories.mockResolvedValue([car, bike]);

    await syncService.pullVehicleCategories();

    expect([...h.vehicleCategories.keys()].sort()).toEqual(['bicycle', 'car']);
    expect(h.vehicleCategories.get('car')).toEqual(car);
  });

  it('una respuesta vacía no pisa lo local', async () => {
    h.vehicleCategories.set('car', car as LocalVehicleCategory);
    h.listVehicleCategories.mockResolvedValue([]);

    await syncService.pullVehicleCategories();

    expect(h.vehicleCategories.has('car')).toBe(true);
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

describe('pullInvoices', () => {
  function invoice(id: string, syncSeq: number): LocalInvoice {
    return {
      id,
      tenantId: TENANT,
      entryId: `entry-${id}`,
      status: 'issued',
      impTotal: 1210,
      syncSeq,
      version: 1,
      updatedAt: ENTERED_AT,
    };
  }

  beforeEach(() => {
    h.invoices.rows.clear();
    h.syncState.clear();
    h.pullInvoiceChanges.mockClear();
    syncService.setCredentials(TENANT, TOKEN);
  });

  it('pagina hasta la última página y guarda el cursor', async () => {
    const full = Array.from({ length: 500 }, (_, i) => invoice(`a${i}`, i + 1));
    h.pullInvoiceChanges
      .mockResolvedValueOnce({ items: full, maxSeq: 500 })
      .mockResolvedValueOnce({ items: [invoice('b', 501)], maxSeq: 501 });

    await syncService.pullInvoices();

    expect(h.pullInvoiceChanges).toHaveBeenCalledTimes(2);
    expect(h.invoices.rows.size).toBe(501);
    expect(h.syncState.get(`invoices:${TENANT}`)?.lastSeq).toBe(501);
  });

  it('la fila del servidor pisa la local (el desktop sólo la lee)', async () => {
    h.invoices.rows.set('x', { ...invoice('x', 1), status: 'pending' });
    h.pullInvoiceChanges.mockResolvedValueOnce({
      items: [invoice('x', 2)],
      maxSeq: 2,
    });

    await syncService.pullInvoices();

    expect(h.invoices.rows.get('x')?.status).toBe('issued');
  });
});

describe('pushLprDetectionEventImages', () => {
  const CAPTURE = 'cap-1';

  function armarDeteccionSinImagen() {
    h.lprDetectionEvents.rows.set(
      'lpr-1',
      localLprEvent('lpr-1', { bestCaptureId: CAPTURE }),
    );
  }

  it('pide la foto COMPLETA comprimida, no el recorte de la patente', async () => {
    // El recorte no deja ver marca, modelo ni color, que es justo para lo que
    // el dueño mira la evidencia. Y va comprimida porque una vez leída la
    // patente la imagen sólo se audita a ojo.
    armarDeteccionSinImagen();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['jpeg'])),
    });
    vi.stubGlobal('fetch', fetchMock);
    h.uploadLprDetectionEventImage.mockResolvedValue(
      serverLprEvent('lpr-1', { imageStoragePath: 't/lpr-1.jpg' }),
    );

    await syncService.pushLprDetectionEventImages();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(`/capture/${CAPTURE}/image.jpg`);
    expect(url).not.toContain('plate.jpg');
    expect(url).toContain('maxWidth=1280');
    expect(url).toContain('quality=55');
    vi.unstubAllGlobals();
  });

  it('no reintenta cuando el backend rechaza el payload', async () => {
    // Un 4xx no se arregla solo: el payload va a ser el mismo. Como la fila
    // queda sin `imageStoragePath`, volvería a elegirse en cada ciclo de sync
    // para siempre. Antes el catch pelado se lo tragaba sin dejar rastro.
    armarDeteccionSinImagen();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['jpeg'])),
      }),
    );
    h.uploadLprDetectionEventImage.mockRejectedValue(
      new ApiError(413, 'Payload Too Large', null),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await syncService.pushLprDetectionEventImages();

    expect(warn).toHaveBeenCalled();
    expect(h.lprDetectionEvents.rows.get('lpr-1')?.imageStoragePath).toBe(
      undefined,
    );
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it('un 5xx sí se reintenta: es transitorio', async () => {
    armarDeteccionSinImagen();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(new Blob(['jpeg'])),
      }),
    );
    h.uploadLprDetectionEventImage.mockRejectedValue(
      new ApiError(503, 'Service Unavailable', null),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await syncService.pushLprDetectionEventImages();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllGlobals();
  });

  it('no sube nada si el servicio de cámara no tiene la captura', async () => {
    armarDeteccionSinImagen();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

    await syncService.pushLprDetectionEventImages();

    expect(h.uploadLprDetectionEventImage.mock.calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('saltea una detección cuya imagen ya purgó la retención', async () => {
    h.lprDetectionEvents.rows.set(
      'lpr-1',
      localLprEvent('lpr-1', {
        bestCaptureId: CAPTURE,
        imageDeletedAt: LEFT_AT,
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await syncService.pushLprDetectionEventImages();

    expect(fetchMock.mock.calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

describe('reconcileCatalogs', () => {
  function tarifaLocal(id: string) {
    h.rates.rows.set(id, localRate(id));
  }

  function servidorDevuelve(ids: string[]) {
    h.listRates.mockResolvedValue(ids.map((id) => ({ id })));
    h.listVehicleTypes.mockResolvedValue([]);
    h.listPaymentMethods.mockResolvedValue([]);
  }

  it('poda la tarifa que el servidor ya no conoce', async () => {
    // El caso del reporte: una tarifa borrada físicamente durante la ventana de
    // bug, que el feed incremental no va a mencionar nunca más.
    tarifaLocal('viva');
    tarifaLocal('fantasma');
    servidorDevuelve(['viva']);

    await syncService.reconcileCatalogs(true);

    expect(h.rates.rows.has('fantasma')).toBe(false);
    expect(h.rates.rows.has('viva')).toBe(true);
  });

  it('pide las inactivas, o borraría toda tarifa desactivada pero viva', async () => {
    // Sin `includeInactive` el backend filtra `isActive: true`. Es el error más
    // caro posible acá: le borraría al dueño tarifas que puede reactivar.
    tarifaLocal('viva');
    servidorDevuelve(['viva']);

    await syncService.reconcileCatalogs(true);

    expect(h.listRates).toHaveBeenCalledWith(
      expect.objectContaining({ query: { includeInactive: true } }),
    );
  });

  it('NO poda una tarifa con una operación encolada', async () => {
    tarifaLocal('recien-creada');
    queueOp('rate', 'recien-creada');
    servidorDevuelve([]);

    await syncService.reconcileCatalogs(true);

    expect(h.rates.rows.has('recien-creada')).toBe(true);
  });

  it('no poda nada si el servidor devuelve vacío y hay filas locales', async () => {
    tarifaLocal('a');
    tarifaLocal('b');
    servidorDevuelve([]);

    await syncService.reconcileCatalogs(true);

    expect(h.rates.rows.size).toBe(2);
  });

  it('no sella el timestamp cuando el listado falla, así reintenta', async () => {
    tarifaLocal('a');
    h.listRates.mockRejectedValue(new Error('sin red'));
    h.listVehicleTypes.mockResolvedValue([]);
    h.listPaymentMethods.mockResolvedValue([]);

    await expect(syncService.reconcileCatalogs(true)).rejects.toThrow();

    expect(h.syncState.get(`reconcile:rate:${TENANT}`)).toBeUndefined();
    expect(h.rates.rows.has('a')).toBe(true);
  });

  it('una entidad que falla no impide que las otras reconcilien', async () => {
    h.listRates.mockRejectedValue(new Error('sin red'));
    h.listVehicleTypes.mockResolvedValue([]);
    h.listPaymentMethods.mockResolvedValue([]);

    await expect(syncService.reconcileCatalogs(true)).rejects.toThrow();

    expect(h.listVehicleTypes).toHaveBeenCalled();
    expect(h.listPaymentMethods).toHaveBeenCalled();
  });

  it('respeta la cadencia: no vuelve a pedir la lista enseguida', async () => {
    tarifaLocal('viva');
    servidorDevuelve(['viva']);

    await syncService.reconcileCatalogs(true);
    expect(h.listRates).toHaveBeenCalledTimes(1);

    await syncService.reconcileCatalogs(false);
    expect(h.listRates).toHaveBeenCalledTimes(1);

    // Pero el botón manual fuerza igual.
    await syncService.reconcileCatalogs(true);
    expect(h.listRates).toHaveBeenCalledTimes(2);
  });

  it('corre DESPUÉS del push, o leería como fantasmas las altas offline', async () => {
    servidorDevuelve([]);
    const push = vi.spyOn(syncService, 'pushPendingOps');

    // `fullSync` acumula los fallos de las etapas que el doble de Dexie no
    // soporta y tira al final; el orden de invocación se mide igual.
    await expect(
      syncService.fullSync({ forceReconcile: true }),
    ).rejects.toThrow();

    expect(push.mock.invocationCallOrder[0]).toBeLessThan(
      h.listRates.mock.invocationCallOrder[0],
    );
    push.mockRestore();
  });
});

describe('pullPaymentMethods y las bajas', () => {
  it('borra el medio de pago que el servidor dio de baja', async () => {
    // Antes el borrado era físico y no viajaba: el medio quedaba en los otros
    // equipos para siempre, seleccionable al cobrar.
    h.paymentMethods.rows.set('pm-1', {
      id: 'pm-1',
      tenantId: TENANT,
      type: 'other',
      name: 'Naranja X',
      enabled: true,
      isDefault: false,
      syncSeq: 1,
      version: 1,
    } as unknown as LocalPaymentMethod);

    h.pullPaymentMethodChanges.mockResolvedValue({
      items: [
        {
          id: 'pm-1',
          type: 'other',
          name: 'Naranja X',
          enabled: true,
          isDefault: false,
          isSystem: false,
          invoiceMode: 'none',
          syncSeq: 2,
          version: 2,
          createdAt: ENTERED_AT,
          updatedAt: ENTERED_AT,
          deletedAt: ENTERED_AT,
        },
      ],
      maxSeq: 2,
    });

    await syncService.pullPaymentMethods();

    expect(h.paymentMethods.rows.has('pm-1')).toBe(false);
  });

  it('la baja se aplica aunque el medio tenga una op encolada', async () => {
    // Una baja es una afirmación del servidor, no una foto vieja: dejar vivo
    // un medio que allá no existe es peor, porque se le sigue cobrando.
    h.paymentMethods.rows.set('pm-1', {
      id: 'pm-1',
      tenantId: TENANT,
      type: 'other',
      name: 'Naranja X',
      enabled: true,
      isDefault: false,
      syncSeq: 1,
      version: 1,
    } as unknown as LocalPaymentMethod);
    queueOp('paymentMethod', 'pm-1');

    h.pullPaymentMethodChanges.mockResolvedValue({
      items: [
        {
          id: 'pm-1',
          type: 'other',
          name: 'Naranja X',
          enabled: true,
          isDefault: false,
          isSystem: false,
          invoiceMode: 'none',
          syncSeq: 2,
          version: 2,
          createdAt: ENTERED_AT,
          updatedAt: ENTERED_AT,
          deletedAt: ENTERED_AT,
        },
      ],
      maxSeq: 2,
    });

    await syncService.pullPaymentMethods();

    expect(h.paymentMethods.rows.has('pm-1')).toBe(false);
  });
});
