// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createEntry, closeEntry, type EntryDto } from '../api/entries';
import {
  upsertLprDetectionEvent,
  updateLprDetectionEvent,
  uploadLprDetectionEventImage,
  type LprDetectionEventDto,
} from '../api/lpr-events';
import {
  localDb,
  type PendingOp,
  type LocalLprDetectionEvent,
} from '../db/localDb';
import { enqueuePendingOp, setEnqueueUserId } from './enqueue';
import { syncService } from './SyncService';
import { cameraDetectionTestUtils } from '../../features/camera/useCameraDetections';

vi.mock('../api/entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/entries')>()),
  createEntry: vi.fn(),
  closeEntry: vi.fn(),
}));
vi.mock('../api/lpr-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/lpr-events')>()),
  upsertLprDetectionEvent: vi.fn(),
  updateLprDetectionEvent: vi.fn(),
  uploadLprDetectionEventImage: vi.fn(),
}));

const tenantId = 'tenant';
const now = '2026-11-19T10:13:06.000Z';
const entry = (id = 'entry'): EntryDto => ({
  id,
  tenantId,
  plate: 'ABC123',
  source: 'manual',
  manuallyInvoiced: false,
  enteredAt: now,
  updatedAt: now,
  version: 1,
  syncSeq: 10,
});
const event = (
  patch: Partial<LocalLprDetectionEvent> = {},
): LocalLprDetectionEvent => ({
  id: 'event',
  tenantId,
  cameraId: 'camera',
  location: 'entrada',
  normalizedText: 'ABC123',
  firstSeenAt: now,
  lastSeenAt: now,
  confidence: 0.9,
  formatValid: true,
  formatType: 'argentina_old',
  qualityStatus: 'valid_high',
  status: 'registered',
  entryId: 'entry',
  candidates: [],
  version: 1,
  syncSeq: 0,
  createdAt: now,
  updatedAt: now,
  ...patch,
});
const serverEvent = (
  patch: Partial<LprDetectionEventDto> = {},
): LprDetectionEventDto => ({
  ...event(),
  candidates: [],
  syncSeq: 11,
  ...patch,
});

async function queueDetection(patch: Partial<PendingOp> = {}) {
  await localDb.lprDetectionEvents.put(event());
  await enqueuePendingOp({
    entityType: 'lprDetectionEvent',
    operation: 'create',
    tenantId,
    entityId: 'event',
    payload: { ...event() },
    status: 'pending',
    ...patch,
  });
}
async function queueEntry(patch: Partial<PendingOp> = {}) {
  await localDb.entries.put({
    id: 'entry',
    tenantId,
    plate: 'ABC123',
    enteredAt: now,
    updatedAt: now,
    version: 1,
    syncSeq: 0,
  });
  await enqueuePendingOp({
    entityType: 'entry',
    operation: 'create',
    tenantId,
    entityId: 'entry',
    payload: { id: 'entry', plate: 'ABC123', enteredAt: now },
    status: 'pending',
    ...patch,
  });
}
const pendingDetection = () =>
  localDb.pendingOps.where('entityType').equals('lprDetectionEvent').first();
const pendingEntry = () =>
  localDb.pendingOps.where('entityType').equals('entry').first();

beforeEach(async () => {
  vi.resetAllMocks();
  localStorage.clear();
  setEnqueueUserId('operator');
  syncService.setCredentials(tenantId, 'test-token', 'operator');
  await Promise.all(localDb.tables.map((table) => table.clear()));
  vi.mocked(createEntry).mockImplementation(({ body }) =>
    Promise.resolve(entry(body.id)),
  );
  vi.mocked(closeEntry).mockResolvedValue({ ...entry(), leftAt: now });
  vi.mocked(upsertLprDetectionEvent).mockImplementation(({ body }) =>
    Promise.resolve(
      serverEvent({ id: body.id, status: body.status, entryId: body.entryId }),
    ),
  );
  vi.mocked(updateLprDetectionEvent).mockResolvedValue(serverEvent());
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('Unexpected network request')),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LPR waits for its persisted entry', () => {
  it('sends an older detection after the offline entry in the same sync', async () => {
    await queueDetection();
    await queueEntry();
    vi.mocked(upsertLprDetectionEvent).mockImplementation(async () => {
      expect(await pendingEntry()).toBeUndefined();
      expect(await localDb.entries.get('entry')).toMatchObject({ syncSeq: 10 });
      return serverEvent();
    });

    await syncService.pushPendingOps();

    expect(createEntry).toHaveBeenCalledOnce();
    expect(upsertLprDetectionEvent).toHaveBeenCalledOnce();
    expect(await localDb.pendingOps.count()).toBe(0);
    expect(await localDb.lprDetectionEvents.get('event')).toMatchObject({
      entryId: 'entry',
      syncSeq: 11,
    });
    await syncService.pushPendingOps();
    expect(createEntry).toHaveBeenCalledOnce();
    expect(upsertLprDetectionEvent).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 409, 500])(
    'keeps the detection intact when the entry fails with %s',
    async (status) => {
      await queueDetection();
      await queueEntry();
      const before = await pendingDetection();
      vi.mocked(createEntry).mockRejectedValue(
        new ApiError(status, 'Rejected', null),
      );

      await syncService.pushPendingOps();

      expect(upsertLprDetectionEvent).not.toHaveBeenCalled();
      expect(await pendingDetection()).toEqual(before);
      expect(await pendingEntry()).toBeDefined();
    },
  );

  it.each(['failed', 'conflict'] as const)(
    'manual sync does not bypass an entry in %s',
    async (status) => {
      await queueDetection();
      await queueEntry({ status });
      const before = await pendingDetection();
      await syncService.pushPendingOps(true);
      expect(createEntry).not.toHaveBeenCalled();
      expect(upsertLprDetectionEvent).not.toHaveBeenCalled();
      expect(await pendingDetection()).toEqual(before);
    },
  );

  it('respects backoff and resumes after reconnection without recreating the detection', async () => {
    await queueDetection();
    await queueEntry();
    vi.mocked(createEntry).mockRejectedValueOnce(
      new ApiError(503, 'Unavailable', null),
    );
    await syncService.pushPendingOps();
    const blocked = await pendingEntry();
    expect(blocked?.nextAttemptAt).toBeGreaterThan(Date.now());
    await syncService.pushPendingOps();
    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(upsertLprDetectionEvent).not.toHaveBeenCalled();

    await syncService.pushPendingOps(true);
    expect(createEntry).toHaveBeenCalledTimes(2);
    expect(upsertLprDetectionEvent).toHaveBeenCalledOnce();
    expect(await localDb.pendingOps.count()).toBe(0);
  });

  it('recovers an interrupted entry push before attempting the detection', async () => {
    await queueDetection();
    await queueEntry({ status: 'in-flight' });
    await syncService.pushPendingOps();
    expect(await localDb.pendingOps.count()).toBe(0);
    expect(createEntry).toHaveBeenCalledOnce();
    expect(upsertLprDetectionEvent).toHaveBeenCalledOnce();
  });

  it('does not send an entry when only LPR was requested', async () => {
    await queueDetection();
    await queueEntry();
    await syncService.pushPendingOps(true, 'lprDetectionEvent');
    expect(createEntry).not.toHaveBeenCalled();
    expect(upsertLprDetectionEvent).not.toHaveBeenCalled();
    expect(await localDb.pendingOps.count()).toBe(2);
  });

  it('does not block other detections, tenants or business operations', async () => {
    await queueDetection();
    await queueEntry({ status: 'failed' });
    await queueDetection({
      entityId: 'other-event',
      payload: { id: 'other-event', status: 'pending' },
      status: 'unreviewed',
    });
    await queueEntry({ tenantId: 'other-tenant', entityId: 'existing' });
    await queueDetection({
      entityId: 'existing-event',
      payload: {
        id: 'existing-event',
        status: 'registered',
        entryId: 'existing',
      },
    });
    await queueEntry({
      entityId: 'manual',
      payload: { id: 'manual', plate: 'DEF456' },
    });

    await syncService.pushPendingOps();

    expect(createEntry).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: { id: 'manual', plate: 'DEF456' } }),
    );
    expect(
      vi.mocked(upsertLprDetectionEvent).mock.calls.map(([arg]) => arg.body.id),
    ).toEqual(['other-event', 'existing-event']);
    expect(await pendingDetection()).toMatchObject({
      entityId: 'event',
      status: 'pending',
      retryCount: 0,
    });
  });

  it('keeps business operations in order and does not wait for a failed exit', async () => {
    await queueDetection();
    await queueEntry();
    await enqueuePendingOp({
      entityType: 'entry',
      tenantId,
      entityId: 'entry',
      operation: 'update',
      payload: { expectedVersion: 1, body: { leftAt: now } },
      status: 'pending',
    });
    vi.mocked(closeEntry).mockImplementation(() => {
      expect(createEntry).toHaveBeenCalledOnce();
      return Promise.reject(new ApiError(409, 'Conflict', null));
    });
    await syncService.pushPendingOps();
    expect(upsertLprDetectionEvent).toHaveBeenCalledOnce();
    expect(await pendingEntry()).toMatchObject({
      operation: 'update',
      status: 'conflict',
    });
  });

  it('does not hide genuine LPR validation errors or retry existing failures', async () => {
    await queueDetection();
    vi.mocked(upsertLprDetectionEvent).mockRejectedValue(
      new ApiError(400, 'Invalid reference', null),
    );
    await syncService.pushPendingOps();
    expect(await pendingDetection()).toMatchObject({ status: 'failed' });
    await syncService.pushPendingOps(true);
    expect(upsertLprDetectionEvent).toHaveBeenCalledOnce();
  });

  it('rereads an operator decision made while another entry was being sent', async () => {
    await queueDetection({
      payload: { id: 'event', status: 'pending' },
      status: 'unreviewed',
    });
    await queueEntry({
      entityId: 'other',
      payload: { id: 'other', plate: 'DEF456' },
    });
    vi.mocked(createEntry).mockImplementationOnce(async () => {
      await queueEntry();
      const op = await pendingDetection();
      await localDb.pendingOps.update(op!.localId!, {
        payload: { id: 'event', status: 'registered', entryId: 'entry' },
        status: 'pending',
      });
      return entry('other');
    });
    await syncService.pushPendingOps();
    expect(upsertLprDetectionEvent).not.toHaveBeenCalled();
    expect(await pendingDetection()).toMatchObject({
      status: 'pending',
      retryCount: 0,
    });
    await syncService.pushPendingOps();
    expect(upsertLprDetectionEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: { id: 'event', status: 'registered', entryId: 'entry' },
      }),
    );
  });

  it('a status update waits for its event create even during backoff', async () => {
    await queueDetection();
    const create = await pendingDetection();
    await localDb.pendingOps.update(create!.localId!, {
      nextAttemptAt: Date.now() + 60_000,
    });
    await queueDetection({
      operation: 'update',
      payload: { status: 'registered', entryId: 'entry' },
    });
    await syncService.pushPendingOps();
    expect(upsertLprDetectionEvent).not.toHaveBeenCalled();
    expect(updateLprDetectionEvent).not.toHaveBeenCalled();
    await syncService.pushPendingOps(true);
    expect(upsertLprDetectionEvent).toHaveBeenCalledOnce();
    expect(updateLprDetectionEvent).toHaveBeenCalledOnce();
  });

  it('camera refreshes cannot overwrite a create in flight or lose a new registration', async () => {
    await localDb.lprDetectionEvents.put(
      event({ status: 'pending', entryId: undefined }),
    );
    await enqueuePendingOp({
      entityType: 'lprDetectionEvent',
      operation: 'create',
      tenantId,
      entityId: 'event',
      payload: { id: 'event', status: 'pending' },
      status: 'unreviewed',
    });
    vi.mocked(upsertLprDetectionEvent).mockImplementationOnce(async () => {
      const inFlight = await pendingDetection();
      expect(inFlight?.status).toBe('in-flight');
      await cameraDetectionTestUtils.storeCameraEvent(tenantId, {
        ...event({ status: 'pending', entryId: undefined }),
        confidence: 0.95,
      });
      await cameraDetectionTestUtils.storeCameraEvent(tenantId, {
        ...event({ status: 'pending', entryId: undefined }),
        confidence: 0.96,
      });
      expect(await localDb.pendingOps.get(inFlight!.localId!)).toEqual(
        inFlight,
      );
      expect(await localDb.pendingOps.count()).toBe(2);
      await queueEntry();
      await cameraDetectionTestUtils.queueStatusUpdate(
        tenantId,
        event(),
        'registered',
        'entry',
      );
      return serverEvent({ status: 'pending', entryId: undefined });
    });
    await syncService.pushPendingOps();
    expect(await pendingDetection()).toMatchObject({
      status: 'pending',
      payload: { status: 'registered', entryId: 'entry' },
    });
    await syncService.pushPendingOps();
    expect(createEntry).toHaveBeenCalledOnce();
    expect(upsertLprDetectionEvent).toHaveBeenCalledTimes(2);
    expect(await localDb.pendingOps.count()).toBe(0);
    expect(await localDb.lprDetectionEvents.get('event')).toMatchObject({
      status: 'registered',
      entryId: 'entry',
      syncSeq: 11,
    });
  });
});

describe('LPR images wait for server acknowledgement', () => {
  it.each(['pending', 'unreviewed', 'failed', 'conflict'] as const)(
    'does not read or upload a photo of an unpersisted %s event',
    async (status) => {
      await queueDetection({ status });
      await localDb.lprDetectionEvents.put(event({ bestCaptureId: 'capture' }));
      await syncService.pushLprDetectionEventImages();
      expect(fetch).not.toHaveBeenCalled();
      expect(uploadLprDetectionEventImage).not.toHaveBeenCalled();
    },
  );

  it('uploads the retained photo after the entry and event succeed', async () => {
    await queueDetection();
    await queueEntry();
    await localDb.lprDetectionEvents.put(event({ bestCaptureId: 'capture' }));
    await syncService.pushLprDetectionEventImages();
    expect(fetch).not.toHaveBeenCalled();
    await syncService.pushPendingOps();
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Blob(['jpeg']), { status: 200 }),
    );
    vi.mocked(uploadLprDetectionEventImage).mockResolvedValue(
      serverEvent({ imageStoragePath: 'tenant/photo.jpg' }),
    );
    await syncService.pushLprDetectionEventImages();
    expect(uploadLprDetectionEventImage).toHaveBeenCalledOnce();
    expect(await localDb.lprDetectionEvents.get('event')).toMatchObject({
      imageStoragePath: 'tenant/photo.jpg',
    });
  });
});
