import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LocalLprDetectionEvent,
  LocalLprIgnoredPlate,
} from '../../lib/db/localDb';

const h = vi.hoisted(() => ({
  rules: [] as LocalLprIgnoredPlate[],
  existing: undefined as LocalLprDetectionEvent | undefined,
  put: vi.fn(),
  enqueue: vi.fn(),
  testing: false,
  transaction: vi.fn(async (_mode: unknown, ...args: unknown[]) =>
    (args.at(-1) as () => Promise<void>)(),
  ),
}));
vi.mock('../../lib/db/localDb', () => ({
  localDb: {
    transaction: h.transaction,
    lprDetectionEvents: {
      get: () => Promise.resolve(h.existing),
      put: h.put,
    },
    lprIgnoredPlates: {
      where: () => ({
        equals: (tenantId: string) => ({
          toArray: () =>
            Promise.resolve(h.rules.filter((row) => row.tenantId === tenantId)),
        }),
      }),
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
vi.mock('../../lib/sync/enqueue', () => ({ enqueuePendingOp: h.enqueue }));
vi.mock('./testingMode', () => ({
  readCameraTestingMode: () => h.testing,
  useCameraTestingMode: () => h.testing,
}));
import { cameraDetectionTestUtils } from './useCameraDetections';
const { storeCameraEvent } = cameraDetectionTestUtils;

const rule: LocalLprIgnoredPlate = {
  id: 'rule',
  tenantId: 'apex',
  plate: 'IAG574',
  active: true,
  validFrom: null,
  validUntil: null,
  notes: null,
  deletedAt: null,
  version: 1,
  syncSeq: 1,
  createdAt: '2026-10-06T12:00:00Z',
  updatedAt: '2026-10-06T12:00:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  h.rules = [rule];
  h.testing = false;
  h.existing = undefined;
});
afterEach(() => vi.unstubAllGlobals());

describe('Lista blanca antes de persistir detecciones desktop', () => {
  it('no guarda ni encola una detección nueva excluida', async () => {
    await storeCameraEvent('apex', { eventId: 'event', text: 'iag-574' });
    expect(h.transaction).toHaveBeenCalled();
    expect(h.put).not.toHaveBeenCalled();
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/detections/event'),
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
  it('en testing guarda y encola la patente normalmente', async () => {
    h.testing = true;
    await storeCameraEvent('apex', { eventId: 'event', text: 'IAG574' });
    expect(h.put).toHaveBeenCalled();
    expect(h.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'lprDetectionEvent' }),
    );
  });
  it('no excluye patentes similares ni reglas de otro estacionamiento', async () => {
    await storeCameraEvent('apex', { eventId: 'similar', text: 'IAG575' });
    await storeCameraEvent('other', { eventId: 'other', text: 'IAG574' });
    expect(h.put).toHaveBeenCalledTimes(2);
    expect(h.enqueue).toHaveBeenCalledTimes(2);
  });
  it('conserva los eventos históricos aunque su patente ahora esté excluida', async () => {
    h.existing = {
      id: 'existing',
      tenantId: 'apex',
      normalizedText: 'IAG574',
      status: 'registered',
    } as LocalLprDetectionEvent;
    await storeCameraEvent('apex', {
      eventId: 'existing',
      text: 'IAG574',
      status: 'registered',
    });
    expect(h.put).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing', status: 'registered' }),
    );
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
