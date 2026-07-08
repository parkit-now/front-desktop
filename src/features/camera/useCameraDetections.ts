import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  localDb,
  type LocalLprDetectionEvent,
  type LprDetectionStatus,
} from '../../lib/db/localDb';
import type {
  UpdateLprDetectionEventDto,
  UpsertLprDetectionEventDto,
} from '../../lib/api/lpr-events';
import { CAMERA_BASE_URL } from '../../lib/camera/constants';

export { CAMERA_BASE_URL };
export const LPR_RECENT_EXIT_SUPPRESSION_MINUTES = 30;

const POLL_MS = 2_000;
const RECENT_EXIT_TICK_MS = 60_000;

type SuppressionStatus = Extract<
  LprDetectionStatus,
  | 'suppressed_active_entry'
  | 'suppressed_pending_event'
  | 'suppressed_recent_exit'
>;

type CameraEventPayload = {
  id?: unknown;
  eventId?: unknown;
  cameraId?: unknown;
  camera_id?: unknown;
  location?: unknown;
  firstSeenAt?: unknown;
  lastSeenAt?: unknown;
  detected_at?: unknown;
  rawText?: unknown;
  normalizedText?: unknown;
  displayPlate?: unknown;
  plate?: unknown;
  text?: unknown;
  confidence?: unknown;
  formatValid?: unknown;
  formatType?: unknown;
  qualityStatus?: unknown;
  status?: unknown;
  entryId?: unknown;
  reviewedAt?: unknown;
  imageStoragePath?: unknown;
  imageUrl?: unknown;
  bestCaptureId?: unknown;
  capture_id?: unknown;
  candidates?: unknown;
  version?: unknown;
  syncSeq?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type PendingDetection = LocalLprDetectionEvent;

interface CameraDetections {
  detections: PendingDetection[];
  dismiss: (eventId: string) => void;
  ack: (eventId: string, entryId: string) => void;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function normalisePlate(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[\s_-]/g, '').toUpperCase();
  return normalized || undefined;
}

function isLprStatus(value: unknown): value is LprDetectionStatus {
  return (
    value === 'pending' ||
    value === 'registered' ||
    value === 'dismissed' ||
    value === 'suppressed_active_entry' ||
    value === 'suppressed_pending_event' ||
    value === 'suppressed_recent_exit'
  );
}

function isResolved(status: LprDetectionStatus): boolean {
  return status !== 'pending';
}

function qualityScore(event: LocalLprDetectionEvent): number {
  const rank = {
    valid_high: 4,
    valid_low: 3,
    low_confidence: 2,
    invalid_format: 1,
  }[event.qualityStatus];
  return rank + event.confidence;
}

function toLocalEvent(
  tenantId: string,
  payload: CameraEventPayload,
  existing?: LocalLprDetectionEvent,
): LocalLprDetectionEvent | null {
  const id = asString(payload.eventId) ?? asString(payload.id);
  if (!id) return null;

  const now = new Date().toISOString();
  const status = isLprStatus(payload.status) ? payload.status : 'pending';
  const nextStatus =
    existing && isResolved(existing.status) && status === 'pending'
      ? existing.status
      : status;
  const normalizedText =
    normalisePlate(
      asString(payload.normalizedText) ?? asString(payload.text),
    ) ?? existing?.normalizedText;
  const displayPlate =
    asString(payload.displayPlate) ??
    asString(payload.plate) ??
    normalizedText ??
    asString(payload.rawText);

  return {
    id,
    tenantId,
    cameraId:
      asString(payload.cameraId) ?? asString(payload.camera_id) ?? 'cam-01',
    location: asString(payload.location) ?? 'entrada',
    firstSeenAt:
      asString(payload.firstSeenAt) ??
      asString(payload.detected_at) ??
      existing?.firstSeenAt ??
      now,
    lastSeenAt:
      asString(payload.lastSeenAt) ??
      asString(payload.detected_at) ??
      existing?.lastSeenAt ??
      now,
    rawText: asString(payload.rawText) ?? existing?.rawText,
    normalizedText,
    displayPlate,
    confidence: asNumber(payload.confidence, existing?.confidence ?? 0),
    formatValid:
      typeof payload.formatValid === 'boolean'
        ? asBoolean(payload.formatValid)
        : (existing?.formatValid ?? false),
    formatType:
      payload.formatType === 'argentina_old' ||
      payload.formatType === 'argentina_mercosur'
        ? payload.formatType
        : (existing?.formatType ?? 'unknown'),
    qualityStatus:
      payload.qualityStatus === 'valid_high' ||
      payload.qualityStatus === 'valid_low' ||
      payload.qualityStatus === 'invalid_format' ||
      payload.qualityStatus === 'low_confidence'
        ? payload.qualityStatus
        : (existing?.qualityStatus ?? 'low_confidence'),
    status: nextStatus,
    entryId: asString(payload.entryId) ?? existing?.entryId,
    reviewedAt: asString(payload.reviewedAt) ?? existing?.reviewedAt,
    imageStoragePath:
      asString(payload.imageStoragePath) ?? existing?.imageStoragePath,
    imageUrl: asString(payload.imageUrl) ?? existing?.imageUrl,
    bestCaptureId:
      asString(payload.bestCaptureId) ??
      asString(payload.capture_id) ??
      existing?.bestCaptureId,
    candidates: Array.isArray(payload.candidates)
      ? payload.candidates
      : (existing?.candidates ?? []),
    version: asNumber(payload.version, existing?.version ?? 1),
    syncSeq: asNumber(payload.syncSeq, existing?.syncSeq ?? 0),
    createdAt: asString(payload.createdAt) ?? existing?.createdAt ?? now,
    updatedAt: asString(payload.updatedAt) ?? existing?.updatedAt ?? now,
  };
}

function toUpsertPayload(
  event: LocalLprDetectionEvent,
): UpsertLprDetectionEventDto {
  return {
    id: event.id,
    cameraId: event.cameraId,
    location: event.location,
    firstSeenAt: event.firstSeenAt,
    lastSeenAt: event.lastSeenAt,
    rawText: event.rawText,
    normalizedText: event.normalizedText,
    displayPlate: event.displayPlate,
    confidence: event.confidence,
    formatValid: event.formatValid,
    formatType: event.formatType,
    qualityStatus: event.qualityStatus,
    status: event.status,
    entryId: event.entryId,
    reviewedAt: event.reviewedAt,
    // imageStoragePath/imageUrl are intentionally NOT sent: the backend
    // ignores them on upsert now (see backend PR #15) since resending our
    // last-known local copy on every camera poll tick could resurrect a
    // path the retention job had already purged from Storage.
    bestCaptureId: event.bestCaptureId,
    candidates: event.candidates as UpsertLprDetectionEventDto['candidates'],
  };
}

function toStatusPayload(
  status: LprDetectionStatus,
  entryId?: string,
  reviewedAt = new Date().toISOString(),
): UpdateLprDetectionEventDto {
  return { status, entryId, reviewedAt };
}

async function upsertCreateOp(
  tenantId: string,
  event: LocalLprDetectionEvent,
): Promise<void> {
  const existing = await localDb.pendingOps
    .where('entityType')
    .equals('lprDetectionEvent')
    .filter(
      (op) =>
        op.tenantId === tenantId &&
        op.entityId === event.id &&
        op.operation === 'create',
    )
    .first();

  const payload = toUpsertPayload(event);
  if (existing?.localId != null) {
    await localDb.pendingOps.update(existing.localId, {
      payload,
      status: 'pending',
      error: undefined,
    });
    return;
  }

  await localDb.pendingOps.add({
    entityType: 'lprDetectionEvent',
    operation: 'create',
    tenantId,
    entityId: event.id,
    payload,
    status: 'pending',
    createdAt: Date.now(),
    retryCount: 0,
  });
}

async function queueStatusUpdate(
  tenantId: string,
  event: LocalLprDetectionEvent,
  status: LprDetectionStatus,
  entryId?: string,
): Promise<void> {
  const reviewedAt = new Date().toISOString();
  const next: LocalLprDetectionEvent = {
    ...event,
    status,
    entryId: entryId ?? event.entryId,
    reviewedAt,
    updatedAt: reviewedAt,
    version: event.version + 1,
  };

  await localDb.transaction(
    'rw',
    localDb.lprDetectionEvents,
    localDb.pendingOps,
    async () => {
      await localDb.lprDetectionEvents.put(next);

      const createOp = await localDb.pendingOps
        .where('entityType')
        .equals('lprDetectionEvent')
        .filter(
          (op) =>
            op.tenantId === tenantId &&
            op.entityId === event.id &&
            op.operation === 'create',
        )
        .first();

      if (createOp?.localId != null) {
        await localDb.pendingOps.update(createOp.localId, {
          payload: toUpsertPayload(next),
          status: 'pending',
          error: undefined,
        });
        return;
      }

      const updateOp = await localDb.pendingOps
        .where('entityType')
        .equals('lprDetectionEvent')
        .filter(
          (op) =>
            op.tenantId === tenantId &&
            op.entityId === event.id &&
            op.operation === 'update',
        )
        .first();

      const payload = toStatusPayload(status, entryId, reviewedAt);
      if (updateOp?.localId != null) {
        await localDb.pendingOps.update(updateOp.localId, {
          payload,
          status: 'pending',
          error: undefined,
        });
        return;
      }

      await localDb.pendingOps.add({
        entityType: 'lprDetectionEvent',
        operation: 'update',
        tenantId,
        entityId: event.id,
        payload,
        status: 'pending',
        createdAt: Date.now(),
        retryCount: 0,
      });
    },
  );
}

async function patchCameraEvent(
  eventId: string,
  status: LprDetectionStatus,
  entryId?: string,
): Promise<void> {
  try {
    await fetch(
      `${CAMERA_BASE_URL}/detections/${encodeURIComponent(eventId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, entryId }),
      },
    );
  } catch {
    // Best effort. Dexie + sync queue remain the source of truth for audit.
  }
}

async function storeCameraEvent(
  tenantId: string,
  payload: CameraEventPayload,
): Promise<void> {
  const id = asString(payload.eventId) ?? asString(payload.id);
  if (!id) return;
  const existing = await localDb.lprDetectionEvents.get(id);
  const event = toLocalEvent(tenantId, payload, existing);
  if (!event) return;

  await localDb.transaction(
    'rw',
    localDb.lprDetectionEvents,
    localDb.pendingOps,
    async () => {
      await localDb.lprDetectionEvents.put(event);
      if (!existing || existing.status === 'pending') {
        await upsertCreateOp(tenantId, event);
      }
    },
  );
}

function keeperByPlate(events: LocalLprDetectionEvent[]): Map<string, string> {
  const keepers = new Map<string, LocalLprDetectionEvent>();
  for (const event of events) {
    if (!event.normalizedText) continue;
    const key = event.normalizedText;
    const current = keepers.get(key);
    if (!current || qualityScore(event) > qualityScore(current)) {
      keepers.set(key, event);
    }
  }
  return new Map([...keepers].map(([plate, event]) => [plate, event.id]));
}

function suppressionReason(
  event: LocalLprDetectionEvent,
  keepers: Map<string, string>,
  activePlates: Set<string>,
  recentExitPlates: Set<string>,
): SuppressionStatus | null {
  const plate = event.normalizedText;
  if (!plate) return null;
  if (activePlates.has(plate)) return 'suppressed_active_entry';
  if (keepers.get(plate) !== event.id) return 'suppressed_pending_event';
  if (recentExitPlates.has(plate)) return 'suppressed_recent_exit';
  return null;
}

export const cameraDetectionTestUtils = {
  keeperByPlate,
  normalisePlate,
  qualityScore,
  suppressionReason,
};

/**
 * Polls the local camera service for pending LPR events, mirrors them into
 * Dexie, and returns only operator-actionable events after local suppression.
 */
export function useCameraDetections(tenantId: string | null): CameraDetections {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), RECENT_EXIT_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const currentTenantId = tenantId;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${CAMERA_BASE_URL}/detections/pending`);
        if (!res.ok) return;
        const data = (await res.json()) as CameraEventPayload[];
        if (cancelled) return;
        await Promise.all(
          data.map((event) => storeCameraEvent(currentTenantId, event)),
        );
      } catch {
        // Service unreachable — keep showing the local Dexie state.
      }
    }
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [tenantId]);

  const pendingEvents = useLiveQuery(async () => {
    if (!tenantId) return [];
    return localDb.lprDetectionEvents
      .where('[tenantId+status]')
      .equals([tenantId, 'pending'])
      .toArray();
  }, [tenantId]);

  const activePlates = useLiveQuery(async () => {
    if (!tenantId) return new Set<string>();
    const rows = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => !e.leftAt)
      .toArray();
    return new Set(rows.map((e) => normalisePlate(e.plate)).filter(isString));
  }, [tenantId]);

  const recentExitPlates = useLiveQuery(async () => {
    if (!tenantId) return new Set<string>();
    const cutoff = nowMs - LPR_RECENT_EXIT_SUPPRESSION_MINUTES * 60_000;
    const rows = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => {
        if (!e.leftAt) return false;
        return new Date(e.leftAt).getTime() >= cutoff;
      })
      .toArray();
    return new Set(rows.map((e) => normalisePlate(e.plate)).filter(isString));
  }, [tenantId, nowMs]);

  const keepers = useMemo(
    () => keeperByPlate(pendingEvents ?? []),
    [pendingEvents],
  );

  useEffect(() => {
    if (!tenantId || !pendingEvents || !activePlates || !recentExitPlates)
      return;
    for (const event of pendingEvents) {
      const reason = suppressionReason(
        event,
        keepers,
        activePlates,
        recentExitPlates,
      );
      if (!reason) continue;
      void queueStatusUpdate(tenantId, event, reason);
      void patchCameraEvent(event.id, reason);
    }
  }, [tenantId, pendingEvents, activePlates, recentExitPlates, keepers]);

  const detections = useMemo(() => {
    const events = pendingEvents ?? [];
    const active = activePlates ?? new Set<string>();
    const recent = recentExitPlates ?? new Set<string>();
    return events
      .filter((event) => !suppressionReason(event, keepers, active, recent))
      .sort(
        (a, b) =>
          new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
      );
  }, [pendingEvents, activePlates, recentExitPlates, keepers]);

  const dismiss = useCallback(
    (eventId: string) => {
      if (!tenantId) return;
      void localDb.lprDetectionEvents.get(eventId).then((event) => {
        if (!event) return;
        void queueStatusUpdate(tenantId, event, 'dismissed');
        void patchCameraEvent(eventId, 'dismissed');
      });
    },
    [tenantId],
  );

  const ack = useCallback(
    (eventId: string, entryId: string) => {
      if (!tenantId) return;
      void localDb.lprDetectionEvents.get(eventId).then((event) => {
        if (!event) return;
        void queueStatusUpdate(tenantId, event, 'registered', entryId);
        void patchCameraEvent(eventId, 'registered', entryId);
      });
    },
    [tenantId],
  );

  return { detections, dismiss, ack };
}
