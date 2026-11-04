// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  localDb,
  type LocalEntry,
  type LocalRate,
  type LocalVehicle,
  type LocalVehicleType,
} from '../../lib/db/localDb';
import { ApiError } from '../../lib/api/client';
import {
  pullPlateProfileChanges,
  writePlateProfile,
} from '../../lib/api/plate-profiles';
import { syncService } from '../../lib/sync/SyncService';
import { enqueuePendingOp, setEnqueueUserId } from '../../lib/sync/enqueue';
import {
  emptyPlateProfile,
  learnLocalPlateProfile,
  plateProfileKey,
  projectPlateProfile,
  resolvePlateProfile,
} from './plateProfiles';
import { mutatePlateProfile } from './plateProfileMutations';

vi.mock('../../lib/api/plate-profiles', () => ({
  pullPlateProfileChanges: vi.fn(),
  writePlateProfile: vi.fn(),
}));
const tenantId = 'tenant';
const userId = 'owner';
const plate = 'AB123CD';
const key = plateProfileKey(tenantId, plate);
const base = () => emptyPlateProfile(tenantId, plate);
const entry = (patch: Partial<LocalEntry> = {}): LocalEntry => ({
  id: 'b',
  tenantId,
  plate,
  enteredAt: '2026-11-03T12:00:00.000Z',
  vehicleBrand: 'Ford',
  vehicleModel: 'Ranger',
  color: 'NEGRO',
  vehicleTypeId: 'pickup',
  vehicleType: 'Pickup',
  rateId: 'rate',
  rateSnapshotName: 'Hora',
  version: 1,
  syncSeq: 0,
  updatedAt: '2026-11-03T12:00:00.000Z',
  ...patch,
});
const credentials = {
  tenantId,
  userId,
  plate,
  bearer: 'token',
  isOnline: false,
};
beforeEach(async () => {
  vi.resetAllMocks();
  setEnqueueUserId(userId);
  syncService.setCredentials(tenantId, 'token', userId);
  await Promise.all([
    localDb.plateProfiles.clear(),
    localDb.pendingOps.clear(),
    localDb.entries.clear(),
    localDb.clients.clear(),
    localDb.syncState.clear(),
  ]);
});

describe('fichas por patente', () => {
  it('usa identidad estable por estacionamiento y patente normalizada', () => {
    expect(plateProfileKey(tenantId, ' ab-123 cd ')).toBe(key);
    expect(plateProfileKey('other', plate)).not.toBe(key);
  });
  it('aprende solo de confirmaciones y no necesita una ficha fiscal', async () => {
    expect(await localDb.plateProfiles.count()).toBe(0);
    await learnLocalPlateProfile(entry());
    expect(await localDb.plateProfiles.get(key)).toMatchObject({
      vehicleBrand: 'Ford',
      vehicleModel: 'Ranger',
      rateId: 'rate',
      lastEntryId: 'b',
    });
    expect(await localDb.clients.count()).toBe(0);
    expect(await localDb.pendingOps.count()).toBe(0);
  });
  it('no permite que una visita antigua o el desempate menor reemplacen la última', () => {
    const current = projectPlateProfile(base(), entry())!;
    expect(
      projectPlateProfile(current, entry({ id: 'a', color: 'ROJO' })),
    ).toBe(current);
    expect(
      projectPlateProfile(
        current,
        entry({ enteredAt: '2026-11-02T00:00:00.000Z' }),
      ),
    ).toBe(current);
    expect(
      projectPlateProfile(current, entry({ id: 'c', color: 'ROJO' }))?.color,
    ).toBe('ROJO');
  });
  it('un nuevo ingreso reemplaza los datos del dueño, sin conservar snapshots de precios', () => {
    const current = {
      ...base(),
      color: 'ROJO',
      learnAfter: '2026-11-02T00:00:00.000Z',
      editVersion: 3,
    };
    const next = projectPlateProfile(current, entry())!;
    expect(next.color).toBe('NEGRO');
    expect(next.editVersion).toBe(3);
    expect(next).not.toHaveProperty('rateSnapshotHourPriceArs');
  });
  it('solo corrige campos pertinentes; notas, egresos y pagos no pisan ediciones del dueño', () => {
    const previous = entry();
    const current = {
      ...projectPlateProfile(base(), previous)!,
      color: 'ROJO',
    };
    expect(
      projectPlateProfile(
        current,
        entry({
          notes: 'nueva',
          leftAt: '2026-11-03T13:00:00Z',
          amountPaid: '1000',
        }),
        previous,
      ),
    ).toBe(current);
    const corrected = projectPlateProfile(
      current,
      entry({ vehicleModel: 'Fiesta' }),
      previous,
    )!;
    expect(corrected.vehicleModel).toBe('Fiesta');
    expect(corrected.color).toBe('ROJO');
  });
  it('borrar estadías conserva la ficha y borrar fichas no las reconstruye desde el historial', () => {
    const current = projectPlateProfile(base(), entry())!;
    expect(
      projectPlateProfile(
        current,
        entry({ deletedAt: '2026-11-03T14:00:00Z' }),
      ),
    ).toBe(current);
    const deleted = { ...current, deletedAt: '2026-11-03T14:00:00.000Z' };
    expect(
      projectPlateProfile(deleted, entry({ color: 'ROJO' }), entry()),
    ).toBe(deleted);
    expect(projectPlateProfile(deleted, entry())).toBe(deleted);
    expect(
      projectPlateProfile(
        deleted,
        entry({ id: 'c', enteredAt: '2026-11-03T15:00:00.000Z' }),
      )?.deletedAt,
    ).toBeNull();
  });
  it('resolver no sustituye opciones desaparecidas y mantiene las otras válidas', () => {
    const profile = projectPlateProfile(base(), entry())!;
    const vehicle = {
      brand: 'Ford',
      model: 'Ranger',
      typeId: 'otro',
    } as LocalVehicle;
    const type = { id: 'otro' } as LocalVehicleType;
    const rate = {
      id: 'rate',
      isActive: true,
      hourPriceArs: '5000',
    } as LocalRate;
    expect(
      resolvePlateProfile(profile, {
        vehicles: [vehicle],
        types: [type],
        rates: [rate],
      }),
    ).toEqual({ vehicle, type: undefined, rate, color: 'NEGRO' });
    expect(
      resolvePlateProfile(
        { ...profile, color: 'ANTIGUO' },
        { vehicles: [], types: [], rates: [] },
      ),
    ).toEqual({
      vehicle: undefined,
      type: undefined,
      rate: undefined,
      color: undefined,
    });
    expect(
      resolvePlateProfile(
        { ...profile, deletedAt: 'now' },
        { vehicles: [vehicle], types: [], rates: [rate] },
      ),
    ).toEqual({});
  });
});

describe('administración y sincronización local-first', () => {
  it('guarda y edita offline, conserva identificador y autor, y sobrevive reinicio', async () => {
    await mutatePlateProfile({ ...credentials, body: { color: 'NEGRO' } });
    let row = (await localDb.plateProfiles.get(key))!;
    await mutatePlateProfile({ ...credentials, row, body: { color: 'ROJO' } });
    row = (await localDb.plateProfiles.get(key))!;
    expect(row.color).toBe('ROJO');
    const ops = await localDb.pendingOps.toArray();
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      userId,
      operation: 'create',
      payload: { color: 'NEGRO', expectedVersion: 0 },
    });
    expect((ops[0].payload as { mutationId: string }).mutationId).toBeTruthy();
    localDb.close();
    await localDb.open();
    expect((await localDb.plateProfiles.get(key))?.color).toBe('ROJO');
    expect(await localDb.pendingOps.count()).toBe(2);
  });
  it('eliminar offline conserva un tombstone sin tocar estadías ni clientes fiscales', async () => {
    const stay = entry();
    await localDb.entries.put(stay);
    await learnLocalPlateProfile(stay);
    await mutatePlateProfile({
      ...credentials,
      row: (await localDb.plateProfiles.get(key))!,
      remove: true,
    });
    expect((await localDb.plateProfiles.get(key))?.deletedAt).toBeTruthy();
    expect(await localDb.entries.get(stay.id)).toEqual(stay);
    expect((await localDb.pendingOps.toArray())[0]).toMatchObject({
      operation: 'delete',
      payload: { expectedVersion: 0 },
    });
  });
  it('un error de red online encola y un conflicto no se anuncia como guardado', async () => {
    vi.mocked(writePlateProfile).mockRejectedValueOnce(
      new TypeError('network'),
    );
    await mutatePlateProfile({
      ...credentials,
      isOnline: true,
      body: { color: 'NEGRO' },
    });
    expect(await localDb.pendingOps.count()).toBe(1);
    await localDb.pendingOps.clear();
    const old = (await localDb.plateProfiles.get(key))!;
    vi.mocked(writePlateProfile).mockRejectedValueOnce(
      new ApiError(409, 'conflict', null),
    );
    await expect(
      mutatePlateProfile({
        ...credentials,
        isOnline: true,
        row: old,
        body: { color: 'ROJO' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await localDb.plateProfiles.get(key))?.color).toBe('NEGRO');
    expect(await localDb.pendingOps.count()).toBe(0);
  });
  it('un operador distinto nunca publica operaciones del dueño', async () => {
    await mutatePlateProfile({ ...credentials, body: { color: 'NEGRO' } });
    syncService.setCredentials(tenantId, 'operator-token', 'operator');
    await syncService.pushPendingOps(false, 'plateProfile');
    expect(writePlateProfile).not.toHaveBeenCalled();
    expect(await localDb.pendingOps.count()).toBe(1);
  });
  it('mantiene operaciones independientes y su orden ante un reintento o conflicto anterior', async () => {
    await mutatePlateProfile({ ...credentials, body: { color: 'NEGRO' } });
    const first = (await localDb.pendingOps.toArray())[0];
    await localDb.pendingOps.update(first.localId!, {
      nextAttemptAt: Date.now() + 60000,
    });
    await mutatePlateProfile({
      ...credentials,
      row: (await localDb.plateProfiles.get(key))!,
      body: { color: 'ROJO' },
    });
    await syncService.pushPendingOps(false, 'plateProfile');
    expect(writePlateProfile).not.toHaveBeenCalled();
    vi.mocked(writePlateProfile).mockImplementation((input) =>
      Promise.resolve({
        ...base(),
        color: input.body.color ?? null,
        editVersion: input.body.expectedVersion + 1,
        version: input.body.expectedVersion + 1,
        syncSeq: input.body.expectedVersion + 1,
      }),
    );
    await syncService.pushPendingOps(true, 'plateProfile');
    expect(writePlateProfile).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(writePlateProfile).mock.calls[1][0].body.expectedVersion,
    ).toBe(1);
    expect((await localDb.plateProfiles.get(key))?.color).toBe('ROJO');
    expect(await localDb.pendingOps.count()).toBe(0);
  });
  it('una confirmación de ficha no pisa un ingreso nuevo que se registró durante el envío', async () => {
    await mutatePlateProfile({ ...credentials, body: { color: 'ROJO' } });
    let release!: (value: ReturnType<typeof base>) => void;
    vi.mocked(writePlateProfile).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const task = syncService.pushPendingOps(false, 'plateProfile');
    await vi.waitFor(() => expect(writePlateProfile).toHaveBeenCalledOnce());
    const stay = entry({
      color: 'AZUL',
      enteredAt: new Date(Date.now() + 1000).toISOString(),
    });
    await localDb.entries.put(stay);
    await learnLocalPlateProfile(stay);
    await enqueuePendingOp({
      entityType: 'entry',
      operation: 'create',
      tenantId,
      entityId: stay.id,
      payload: {},
      status: 'pending',
    });
    release({
      ...base(),
      color: 'ROJO',
      editVersion: 1,
      version: 1,
      syncSeq: 10,
    });
    await task;
    expect((await localDb.plateProfiles.get(key))?.color).toBe('AZUL');
  });
  it('sincroniza el mismo idempotency key al reintentar y conserva errores reintentables', async () => {
    await mutatePlateProfile({ ...credentials, body: { color: 'NEGRO' } });
    vi.mocked(writePlateProfile).mockRejectedValueOnce(
      new TypeError('network'),
    );
    await syncService.pushPendingOps(true, 'plateProfile');
    expect((await localDb.pendingOps.toArray())[0].status).toBe('pending');
    const remote = {
      ...base(),
      color: 'NEGRO',
      editVersion: 1,
      version: 1,
      syncSeq: 5,
    };
    vi.mocked(writePlateProfile).mockResolvedValue(remote);
    await syncService.pushPendingOps(true, 'plateProfile');
    expect(vi.mocked(writePlateProfile).mock.calls[0][0].body.mutationId).toBe(
      vi.mocked(writePlateProfile).mock.calls[1][0].body.mutationId,
    );
    expect(await localDb.pendingOps.count()).toBe(0);
    expect((await localDb.plateProfiles.get(key))?.syncSeq).toBe(5);
  });
  it('un conflicto conserva el borrador local hasta que el dueño lo resuelva', async () => {
    await mutatePlateProfile({ ...credentials, body: { color: 'ROJO' } });
    vi.mocked(writePlateProfile).mockRejectedValue(
      new ApiError(409, 'conflict', null),
    );
    await syncService.pushPendingOps(true, 'plateProfile');
    expect((await localDb.pendingOps.toArray())[0].status).toBe('conflict');
    vi.mocked(pullPlateProfileChanges).mockResolvedValue({
      items: [{ ...base(), color: 'NEGRO', syncSeq: 7 }],
      maxSeq: 7,
    });
    await syncService.pullPlateProfiles();
    expect((await localDb.plateProfiles.get(key))?.color).toBe('ROJO');
    expect(
      (await localDb.syncState.get(`plateProfiles:${tenantId}`))?.lastSeq,
    ).toBe(6);
  });
  it('un pull conserva proyecciones de ingresos pendientes y vuelve a leerlas tras su confirmación', async () => {
    const stay = entry();
    await localDb.entries.put(stay);
    await learnLocalPlateProfile(stay);
    await enqueuePendingOp({
      entityType: 'entry',
      operation: 'create',
      tenantId,
      entityId: stay.id,
      payload: {},
      status: 'pending',
    });
    const server = { ...base(), color: 'ROJO', syncSeq: 8 };
    vi.mocked(pullPlateProfileChanges).mockResolvedValue({
      items: [server],
      maxSeq: 8,
    });
    await syncService.pullPlateProfiles();
    expect((await localDb.plateProfiles.get(key))?.color).toBe('NEGRO');
    expect(
      (await localDb.syncState.get(`plateProfiles:${tenantId}`))?.lastSeq,
    ).toBe(7);
    await localDb.pendingOps.clear();
    await syncService.pullPlateProfiles();
    expect((await localDb.plateProfiles.get(key))?.color).toBe('ROJO');
    expect(vi.mocked(pullPlateProfileChanges).mock.calls[1][0].afterSeq).toBe(
      7,
    );
  });
  it('reconcilia tombstones y evita duplicados o reemplazos con respuestas antiguas', async () => {
    await localDb.plateProfiles.put({ ...base(), color: 'ROJO', syncSeq: 9 });
    vi.mocked(pullPlateProfileChanges).mockResolvedValue({
      items: [{ ...base(), color: 'NEGRO', syncSeq: 8 }],
      maxSeq: 8,
    });
    await syncService.pullPlateProfiles();
    expect((await localDb.plateProfiles.get(key))?.color).toBe('ROJO');
    vi.mocked(pullPlateProfileChanges).mockResolvedValue({
      items: [{ ...base(), syncSeq: 10, deletedAt: '2026-11-03T15:00:00Z' }],
      maxSeq: 10,
    });
    await syncService.pullPlateProfiles();
    expect((await localDb.plateProfiles.get(key))?.deletedAt).toBeTruthy();
    expect(await localDb.plateProfiles.count()).toBe(1);
  });
  it('un conflicto no impide descargar las páginas siguientes del feed', async () => {
    await mutatePlateProfile({ ...credentials, body: { color: 'ROJO' } });
    const items = Array.from({ length: 1000 }, (_, index) => ({
      ...base(),
      plate: index === 0 ? plate : `X${index}`,
      syncSeq: index + 1,
    }));
    vi.mocked(pullPlateProfileChanges)
      .mockResolvedValueOnce({ items, maxSeq: 1000 })
      .mockResolvedValueOnce({
        items: [{ ...base(), plate: 'ULTIMA', syncSeq: 1001 }],
        maxSeq: 1001,
      });
    await syncService.pullPlateProfiles();
    expect(
      (await localDb.plateProfiles.get(plateProfileKey(tenantId, 'ULTIMA')))
        ?.syncSeq,
    ).toBe(1001);
    expect((await localDb.plateProfiles.get(key))?.color).toBe('ROJO');
    expect(
      (await localDb.syncState.get(`plateProfiles:${tenantId}`))?.lastSeq,
    ).toBe(0);
  });
});
