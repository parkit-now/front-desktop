import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalLprDetectionEvent } from '../../lib/db/localDb';

const mock = vi.hoisted(() => ({
  event: undefined as LocalLprDetectionEvent | undefined,
  put: vi.fn(),
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
          filter: () => ({ first: () => Promise.resolve(undefined) }),
        }),
      }),
    },
  },
}));
vi.mock('../../lib/sync/enqueue', () => ({ enqueuePendingOp: mock.enqueue }));

import { cameraDetectionTestUtils } from './useCameraDetections';

const { dismissPendingDetection } = cameraDetectionTestUtils;

beforeEach(() => {
  vi.clearAllMocks();
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
