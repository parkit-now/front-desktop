import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  localDb,
  type LocalLprDetectionEvent,
  type LprDetectionStatus,
  type PendingOpStatus,
} from '../../lib/db/localDb';
import { enqueuePendingOp } from '../../lib/sync/enqueue';
import type {
  UpdateLprDetectionEventDto,
  UpsertLprDetectionEventDto,
} from '../../lib/api/lpr-events';
import { CAMERA_BASE_URL } from '../../lib/camera/constants';
import { useNetwork } from '../../lib/network/NetworkContext';
import { useSync } from '../../lib/sync/SyncContext';
import { parsePlateBbox } from './plateBbox';
import { readCameraTestingMode, useCameraTestingMode } from './testingMode';
import { isIgnoredPlate } from '../lpr-whitelist/whitelistUtils';

export { CAMERA_BASE_URL };
export const LPR_RECENT_EXIT_SUPPRESSION_MINUTES = 30;

const PENDING_RECONCILE_MS = 30_000;
/**
 * Cada cuánto se le reenvía al servicio de cámara la lista de autos adentro.
 * Tiene que ser holgadamente menor que el vencimiento del otro lado (30 s), o
 * la lista caduca entre envío y envío y la supresión se apaga sola.
 */
export const KNOWN_PLATES_PUSH_MS = 10_000;
export const CAMERA_KNOWN_PLATES_TTL_MS = 30_000;
const RECENT_EXIT_TICK_MS = 60_000;
const PENDING_DUPLICATE_WINDOW_MS = 2 * 60_000;
const BLANK_DUPLICATE_WINDOW_MS = 10_000;

type SuppressionStatus = Extract<
  LprDetectionStatus,
  | 'suppressed_active_entry'
  | 'suppressed_pending_event'
  | 'suppressed_recent_exit'
>;

type CameraEventPayload = {
  plateBbox?: unknown;
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
  dismissAll: (eventIds: readonly string[]) => Promise<{
    dismissed: number;
    failed: number;
  }>;
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

function fuzzyPlate(value: string | undefined): string | undefined {
  const normalized = normalisePlate(value);
  if (!normalized) return undefined;
  return normalized
    .replace(/[OD]/g, '0')
    .replace(/I/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] =
        a[i - 1] === b[j - 1]
          ? previous[j - 1]
          : Math.min(previous[j - 1], previous[j], current[j - 1]) + 1;
    }
    previous = current;
  }
  return previous[b.length];
}

function plateDistance(a: string | undefined, b: string | undefined): number {
  const left = normalisePlate(a);
  const right = normalisePlate(b);
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.min(
    levenshteinDistance(left, right),
    levenshteinDistance(fuzzyPlate(left) ?? left, fuzzyPlate(right) ?? right),
  );
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

function detectionSeenAt(event: LocalLprDetectionEvent): number {
  const time = new Date(event.lastSeenAt || event.firstSeenAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function pendingDuplicateDistanceLimit(
  a: LocalLprDetectionEvent,
  b: LocalLprDetectionEvent,
): number {
  const shortest = Math.min(
    a.normalizedText?.length ?? 0,
    b.normalizedText?.length ?? 0,
  );
  if (shortest >= 7) return 3;
  if (shortest === 6) return 2;
  return 1;
}

function isBlankWeakDetection(event: LocalLprDetectionEvent): boolean {
  return (
    !event.normalizedText &&
    (event.qualityStatus === 'low_confidence' ||
      event.qualityStatus === 'invalid_format')
  );
}

function samePendingVehicleCluster(
  a: LocalLprDetectionEvent,
  b: LocalLprDetectionEvent,
): boolean {
  if (a.id === b.id) return true;
  if (a.cameraId !== b.cameraId || a.location !== b.location) return false;

  const elapsed = Math.abs(detectionSeenAt(a) - detectionSeenAt(b));
  if (elapsed > PENDING_DUPLICATE_WINDOW_MS) return false;

  const distance = plateDistance(a.normalizedText, b.normalizedText);
  if (
    Number.isFinite(distance) &&
    distance <= pendingDuplicateDistanceLimit(a, b)
  ) {
    return true;
  }

  return (
    elapsed <= BLANK_DUPLICATE_WINDOW_MS &&
    isBlankWeakDetection(a) &&
    isBlankWeakDetection(b)
  );
}

function parseCameraEventMessage(data: string): CameraEventPayload | null {
  try {
    const parsed = JSON.parse(data) as unknown;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
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
    plateBbox: parsePlateBbox(payload.plateBbox) ?? existing?.plateBbox,
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
    // Esto SÍ se manda, a diferencia de los campos de imagen de arriba: el
    // backend no tiene forma de derivarlo, sólo lo sabe el equipo que capturó.
    plateBbox: event.plateBbox,
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
      status: 'unreviewed',
      error: undefined,
      // El payload se rearmó, así que el backoff y los intentos del fallo
      // anterior ya no aplican: si no se limpian, el filtro de `nextAttemptAt`
      // dejaría la op fuera del próximo push.
      nextAttemptAt: undefined,
      retryCount: 0,
    });
    return;
  }

  await enqueuePendingOp({
    entityType: 'lprDetectionEvent',
    operation: 'create',
    tenantId,
    entityId: event.id,
    payload,
    status: 'unreviewed',
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

  // Only an actual operator decision (registered/dismissed) should surface
  // as a pending change — automatic suppression (duplicate plate, already
  // active, recently exited) is system noise the operator never sees.
  const opStatus: PendingOpStatus =
    status === 'registered' || status === 'dismissed'
      ? 'pending'
      : 'unreviewed';

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
          status: opStatus,
          error: undefined,
          nextAttemptAt: undefined,
          retryCount: 0,
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
          status: opStatus,
          error: undefined,
          nextAttemptAt: undefined,
          retryCount: 0,
        });
        return;
      }

      await enqueuePendingOp({
        entityType: 'lprDetectionEvent',
        operation: 'update',
        tenantId,
        entityId: event.id,
        payload,
        status: opStatus,
      });
    },
  );
}

async function dismissPendingDetection(
  tenantId: string,
  eventId: string,
): Promise<boolean> {
  const event = await localDb.lprDetectionEvents.get(eventId);
  if (!event || event.tenantId !== tenantId || event.status !== 'pending')
    return false;
  await queueStatusUpdate(tenantId, event, 'dismissed');
  void patchCameraEvent(eventId, 'dismissed');
  return true;
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

  // El servicio sigue creyendo que esta detección está pendiente, pero acá ya
  // se resolvió. Reenviarle el aviso que se perdió.
  //
  // POR QUÉ HACE FALTA RECONCILIAR Y NO ALCANZA CON AVISAR UNA VEZ
  //
  // `patchCameraEvent` es best-effort: si el servicio está reiniciándose
  // cuando el operador descarta una tarjeta, el aviso se pierde y NADA lo
  // reintenta. Esa fila se queda `pending` para siempre en su base.
  //
  // Eso derivó en 69 filas zombi, algunas de un mes atrás, y mientras el
  // servicio usó su propia base para decidir si ya tenía una tarjeta de esa
  // patente, una sola de esas filas dejaba al auto sin poder detectarse nunca
  // más. Ya no la usa para eso, pero la deriva se arregla igual acá: cada
  // poll es una oportunidad de volver a intentarlo, así que se cura sola.
  if (shouldResendResolution(existing, payload.status)) {
    void patchCameraEvent(id, existing!.status, existing!.entryId);
  }

  await localDb.transaction(
    'rw',
    localDb.lprDetectionEvents,
    localDb.pendingOps,
    localDb.lprIgnoredPlates,
    async () => {
      if (!existing && !readCameraTestingMode()) {
        const rules = await localDb.lprIgnoredPlates
          .where('tenantId')
          .equals(tenantId)
          .toArray();
        if (
          isIgnoredPlate(
            event.normalizedText ?? event.displayPlate ?? event.rawText ?? '',
            rules,
          )
        ) {
          void patchCameraEvent(id, 'dismissed');
          return;
        }
      }
      await localDb.lprDetectionEvents.put(event);
      if (!existing || existing.status === 'pending') {
        await upsertCreateOp(tenantId, event);
      }
    },
  );
}

function betterPendingKeeper(
  a: LocalLprDetectionEvent,
  b: LocalLprDetectionEvent,
): LocalLprDetectionEvent {
  const scoreDiff = qualityScore(a) - qualityScore(b);
  if (scoreDiff !== 0) return scoreDiff > 0 ? a : b;

  const lengthDiff =
    (a.normalizedText?.length ?? 0) - (b.normalizedText?.length ?? 0);
  if (lengthDiff !== 0) return lengthDiff > 0 ? a : b;

  return detectionSeenAt(a) >= detectionSeenAt(b) ? a : b;
}

function keeperByPlate(events: LocalLprDetectionEvent[]): Map<string, string> {
  const clusters: LocalLprDetectionEvent[][] = [];
  const sorted = [...events].sort(
    (a, b) => detectionSeenAt(a) - detectionSeenAt(b),
  );

  let previousEvent: LocalLprDetectionEvent | undefined;
  for (const event of sorted) {
    if (isBlankWeakDetection(event)) {
      const previous = previousEvent;
      const previousClusterIndex = previous
        ? clusters.findIndex((cluster) => cluster.includes(previous))
        : -1;
      if (
        previous &&
        previousClusterIndex >= 0 &&
        isBlankWeakDetection(previous) &&
        samePendingVehicleCluster(previous, event)
      ) {
        clusters[previousClusterIndex].push(event);
      } else {
        clusters.push([event]);
      }
      previousEvent = event;
      continue;
    }

    const matchingIndexes = clusters
      .map((cluster, index) =>
        cluster.some((candidate) => samePendingVehicleCluster(candidate, event))
          ? index
          : -1,
      )
      .filter((index) => index >= 0);

    if (matchingIndexes.length !== 1) {
      clusters.push([event]);
      previousEvent = event;
      continue;
    }

    clusters[matchingIndexes[0]].push(event);
    previousEvent = event;
  }

  const keepers = new Map<string, string>();
  for (const cluster of clusters) {
    const keeper = cluster.reduce(betterPendingKeeper);
    for (const event of cluster) keepers.set(event.id, keeper.id);
  }
  return keepers;
}

function suppressionReason(
  event: LocalLprDetectionEvent,
  keepers: Map<string, string>,
  activePlates: Set<string>,
  recentExitPlates: Set<string>,
  testingMode = false,
): SuppressionStatus | null {
  // Modo prueba: se ve todo. Ver `testingMode.ts`.
  if (testingMode) return null;
  const plate = event.normalizedText;
  if (plate && activePlates.has(plate)) return 'suppressed_active_entry';
  if (keepers.has(event.id) && keepers.get(event.id) !== event.id) {
    return 'suppressed_pending_event';
  }
  if (plate && recentExitPlates.has(plate)) return 'suppressed_recent_exit';
  return null;
}

/**
 * Si hay que reenviarle al servicio de cámara una resolución que se perdió.
 *
 * `patchCameraEvent` es best-effort: si el servicio estaba reiniciándose
 * cuando el operador descartó la tarjeta, el aviso se perdió y nada lo
 * reintenta. Cada poll es una oportunidad de darse cuenta y reintentarlo.
 */
export function shouldResendResolution(
  existing: LocalLprDetectionEvent | undefined,
  incomingStatus: unknown,
): boolean {
  return Boolean(
    existing && isResolved(existing.status) && incomingStatus === 'pending',
  );
}

/**
 * Las patentes de las que NO queremos otra tarjeta: las que ya están adentro
 * y las que ya tienen una tarjeta abierta esperando al operador.
 */
export function platesToSuppress(
  activePlates: Set<string>,
  pendingEvents: LocalLprDetectionEvent[],
): string[] {
  const plates = new Set<string>();
  for (const plate of activePlates) {
    const normalized = normalisePlate(plate);
    if (normalized) plates.add(normalized);
  }
  for (const event of pendingEvents) {
    if (event.status !== 'pending') continue;
    const normalized = normalisePlate(
      event.normalizedText ?? event.displayPlate ?? event.rawText,
    );
    if (normalized) plates.add(normalized);
  }
  return Array.from(plates).sort();
}

/**
 * En modo prueba la lista va vacía y con `testingMode: true`, que además le
 * apaga al servicio su propio cooldown por patente. El servicio lo da por
 * vencido si deja de llegar, así que el reenvío periódico es lo que lo mantiene.
 */
export async function pushKnownPlatesSnapshot(
  activePlates: Set<string>,
  pendingEvents: LocalLprDetectionEvent[],
  fetchImpl: typeof fetch = fetch,
  testingMode = false,
): Promise<void> {
  const plates = testingMode
    ? []
    : platesToSuppress(activePlates, pendingEvents);
  await fetchImpl(`${CAMERA_BASE_URL}/known-plates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plates, testingMode }),
  });
}

export const cameraDetectionTestUtils = {
  dismissPendingDetection,
  keeperByPlate,
  normalisePlate,
  parseCameraEventMessage,
  plateDistance,
  CAMERA_KNOWN_PLATES_TTL_MS,
  KNOWN_PLATES_PUSH_MS,
  platesToSuppress,
  pushKnownPlatesSnapshot,
  qualityScore,
  samePendingVehicleCluster,
  shouldResendResolution,
  storeCameraEvent,
  suppressionReason,
};

/**
 * Polls the local camera service for pending LPR events, mirrors them into
 * Dexie, and returns only operator-actionable events after local suppression.
 */
export function useCameraDetections(tenantId: string | null): CameraDetections {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const { isOnline } = useNetwork();
  const { triggerSync } = useSync();
  const testingMode = useCameraTestingMode();
  const ignoredRules = useLiveQuery(
    () =>
      tenantId
        ? localDb.lprIgnoredPlates.where('tenantId').equals(tenantId).toArray()
        : [],
    [tenantId],
  );

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), RECENT_EXIT_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const currentTenantId = tenantId;
    let cancelled = false;

    async function reconcilePending() {
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

    function handleDetectionMessage(message: MessageEvent<string>) {
      const event = parseCameraEventMessage(message.data);
      if (event) void storeCameraEvent(currentTenantId, event);
    }

    void reconcilePending();
    const reconcileId = setInterval(
      () => void reconcilePending(),
      PENDING_RECONCILE_MS,
    );

    const source =
      typeof EventSource === 'undefined'
        ? null
        : new EventSource(`${CAMERA_BASE_URL}/detections/events`);
    source?.addEventListener('detection', handleDetectionMessage);
    source?.addEventListener('error', () => {
      // Normal in Windows/exe startup or when the local service restarts.
      // EventSource reconnects by itself; pending reconciliation is the fallback.
    });

    return () => {
      cancelled = true;
      clearInterval(reconcileId);
      source?.close();
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
      .filter((e) => !e.leftAt && !e.deletedAt)
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
        if (!e.leftAt || e.deletedAt) return false;
        return new Date(e.leftAt).getTime() >= cutoff;
      })
      .toArray();
    return new Set(rows.map((e) => normalisePlate(e.plate)).filter(isString));
  }, [tenantId, nowMs]);

  const keepers = useMemo(
    () =>
      keeperByPlate(
        (pendingEvents ?? []).filter(
          (event) =>
            testingMode ||
            !isIgnoredPlate(
              event.normalizedText ?? event.displayPlate ?? event.rawText ?? '',
              ignoredRules ?? [],
              nowMs,
            ),
        ),
      ),
    [pendingEvents, testingMode, ignoredRules, nowMs],
  );

  useEffect(() => {
    if (!tenantId || !pendingEvents || !activePlates || !recentExitPlates)
      return;
    for (const event of pendingEvents) {
      if (
        !testingMode &&
        isIgnoredPlate(
          event.normalizedText ?? event.displayPlate ?? event.rawText ?? '',
          ignoredRules ?? [],
          nowMs,
        )
      )
        continue;
      const reason = suppressionReason(
        event,
        keepers,
        activePlates,
        recentExitPlates,
        testingMode,
      );
      if (!reason) continue;
      void queueStatusUpdate(tenantId, event, reason);
      void patchCameraEvent(event.id, reason);
    }
  }, [
    tenantId,
    pendingEvents,
    activePlates,
    recentExitPlates,
    keepers,
    testingMode,
    ignoredRules,
    nowMs,
  ]);

  const detections = useMemo(() => {
    const events = pendingEvents ?? [];
    const active = activePlates ?? new Set<string>();
    const recent = recentExitPlates ?? new Set<string>();
    return events
      .filter(
        (event) =>
          (testingMode ||
            !isIgnoredPlate(
              event.normalizedText ?? event.displayPlate ?? event.rawText ?? '',
              ignoredRules ?? [],
              nowMs,
            )) &&
          !suppressionReason(event, keepers, active, recent, testingMode),
      )
      .sort(
        (a, b) =>
          new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime(),
      );
  }, [
    pendingEvents,
    activePlates,
    recentExitPlates,
    keepers,
    testingMode,
    ignoredRules,
    nowMs,
  ]);

  const dismissPending = useCallback(
    async (eventId: string): Promise<boolean> => {
      if (!tenantId) return false;
      return dismissPendingDetection(tenantId, eventId);
    },
    [tenantId],
  );

  const dismiss = useCallback(
    (eventId: string) => {
      void dismissPending(eventId).then((changed) => {
        if (changed && isOnline) void triggerSync();
      });
    },
    [dismissPending, isOnline, triggerSync],
  );

  const dismissAll = useCallback(
    async (eventIds: readonly string[]) => {
      let dismissed = 0;
      let failed = 0;
      for (const eventId of new Set(eventIds)) {
        try {
          if (await dismissPending(eventId)) dismissed += 1;
        } catch {
          failed += 1;
        }
      }
      if (dismissed > 0 && isOnline) void triggerSync();
      return { dismissed, failed };
    },
    [dismissPending, isOnline, triggerSync],
  );

  const ack = useCallback(
    (eventId: string, entryId: string) => {
      if (!tenantId) return;
      void localDb.lprDetectionEvents.get(eventId).then(async (event) => {
        if (!event) return;
        await queueStatusUpdate(tenantId, event, 'registered', entryId);
        void patchCameraEvent(eventId, 'registered', entryId);
        if (isOnline) void triggerSync();
      });
    },
    [tenantId, isOnline, triggerSync],
  );

  return { detections, dismiss, dismissAll, ack };
}
