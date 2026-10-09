import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalLprDetectionEvent } from '../../lib/db/localDb';

const mock = vi.hoisted(() => ({
  event: undefined as LocalLprDetectionEvent | undefined,
  ops: [] as Array<{
    localId: number;
    tenantId: string;
    entityId: string;
    operation: string;
    status: string;
  }>,
  put: vi.fn(),
  update: vi.fn(),
  enqueue: vi.fn(),
  transaction: vi.fn(async (_mode: unknown, ...args: unknown[]) =>
    (args.at(-1) as () => Promise<void>)(),
  ),
}));

vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    transaction: mock.transaction,
    lprDetectionEvents: {
      get: () => Promise.resolve(mock.event),
      put: mock.put,
    },
    pendingOps: {
      where: () => ({
        equals: () => ({
          filter: (predicate: (op: (typeof mock.ops)[number]) => boolean) => ({
            first: () => Promise.resolve(mock.ops.find(predicate)),
          }),
        }),
      }),
      update: mock.update,
    },
  },
}));
vi.mock('../../lib/sync/enqueue', () => ({ enqueuePendingOp: mock.enqueue }));

import { cameraDetectionTestUtils } from './useCameraDetections';

const { dismissPendingDetection, queueStatusUpdate, storeCameraEvent } =
  cameraDetectionTestUtils;

beforeEach(() => {
  vi.clearAllMocks();
  mock.ops.length = 0;
  mock.put.mockImplementation((row: LocalLprDetectionEvent) => {
    mock.event = row;
    return Promise.resolve();
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  mock.event = {
    id: 'event',
    tenantId: 'tenant',
    status: 'pending',
    version: 1,
  } as LocalLprDetectionEvent;
});

afterEach(() => vi.unstubAllGlobals());

describe('descarte de detecciones pendientes', () => {
  it('usa la misma actualización local, cola de sync y aviso a cámara', async () => {
    expect(await dismissPendingDetection('tenant', 'event')).toBe(true);
    expect(mock.put).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'dismissed', version: 2 }),
    );
    expect(mock.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'lprDetectionEvent',
        operation: 'update',
        tenantId: 'tenant',
        entityId: 'event',
      }),
    );
    const queued: unknown = mock.enqueue.mock.calls[0]?.[0];
    expect(queued).toMatchObject({ payload: { status: 'dismissed' } });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/detections/event'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('ignora otro estacionamiento o una detección ya resuelta', async () => {
    expect(await dismissPendingDetection('other', 'event')).toBe(false);
    mock.event = { ...mock.event!, status: 'registered' };
    expect(await dismissPendingDetection('tenant', 'event')).toBe(false);
    expect(mock.put).not.toHaveBeenCalled();
    expect(mock.enqueue).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('registro de una detección', () => {
  it('ignora una supresión tardía y conserva la foto y el ingreso vinculados', async () => {
    const stale = { ...mock.event! };
    mock.event = { ...mock.event!, imageStoragePath: 'tenant/photo.jpg' };

    expect(
      await queueStatusUpdate('tenant', stale, 'registered', 'entry-1'),
    ).toBe(true);
    expect(
      await queueStatusUpdate('tenant', stale, 'suppressed_active_entry'),
    ).toBe(false);

    expect(mock.event).toMatchObject({
      status: 'registered',
      entryId: 'entry-1',
      imageStoragePath: 'tenant/photo.jpg',
      version: 2,
    });
    expect(mock.put).toHaveBeenCalledTimes(1);
    expect(mock.enqueue).toHaveBeenCalledTimes(1);
  });

  it('permite registrar si la supresión automática ganó la primera carrera', async () => {
    const stale = { ...mock.event! };
    expect(
      await queueStatusUpdate('tenant', stale, 'suppressed_active_entry'),
    ).toBe(true);
    expect(
      await queueStatusUpdate('tenant', stale, 'registered', 'entry-1'),
    ).toBe(true);

    expect(mock.event).toMatchObject({
      status: 'registered',
      entryId: 'entry-1',
      version: 3,
    });
    const queued: unknown = mock.enqueue.mock.calls.at(-1)?.[0];
    expect(queued).toMatchObject({
      payload: { status: 'registered', entryId: 'entry-1' },
    });
  });

  it('encola la decisión nueva sin modificar un envío ya en vuelo', async () => {
    mock.ops.push({
      localId: 1,
      tenantId: 'tenant',
      entityId: 'event',
      operation: 'create',
      status: 'in-flight',
    });

    expect(
      await queueStatusUpdate('tenant', mock.event!, 'registered', 'entry-1'),
    ).toBe(true);
    expect(mock.update).not.toHaveBeenCalled();
    const queued: unknown = mock.enqueue.mock.calls[0]?.[0];
    expect(queued).toMatchObject({
      operation: 'update',
      payload: { entryId: 'entry-1' },
    });
  });

  it('un refresco viejo de cámara no revierte el registro ni pierde su imagen', async () => {
    mock.event = {
      ...mock.event!,
      status: 'registered',
      entryId: 'entry-1',
      imageStoragePath: 'tenant/photo.jpg',
    };

    await storeCameraEvent('tenant', {
      id: 'event',
      status: 'suppressed_active_entry',
      bestCaptureId: 'capture-1',
    });

    expect(mock.event).toMatchObject({
      status: 'registered',
      entryId: 'entry-1',
      imageStoragePath: 'tenant/photo.jpg',
      bestCaptureId: 'capture-1',
    });
    expect(mock.enqueue).not.toHaveBeenCalled();
  });
});
