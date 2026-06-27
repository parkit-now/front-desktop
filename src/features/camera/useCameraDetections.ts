import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { localDb } from '../../lib/db/localDb';

export const CAMERA_BASE_URL = 'http://127.0.0.1:8766';
const POLL_MS = 2_000;

export interface PendingDetection {
  capture_id: string;
  plate: string; // display form, e.g. "AB 123 CD"
  text: string; // normalised, e.g. "AB123CD" — matches stored entry plates
  confidence: number;
  location: string;
  camera_id: string;
  detected_at: string;
}

async function deletePending(plate: string): Promise<void> {
  try {
    await fetch(
      `${CAMERA_BASE_URL}/detections/pending/${encodeURIComponent(plate)}`,
      { method: 'DELETE' },
    );
  } catch {
    // Best effort — the camera service may be unreachable.
  }
}

interface CameraDetections {
  detections: PendingDetection[];
  /** Operator discarded the suggestion without registering. */
  dismiss: (plate: string) => void;
  /** Suggestion was registered as an entry. */
  ack: (plate: string) => void;
}

/**
 * Polls the local camera service for plates detected but not yet acted on, and
 * suppresses any plate already active in base (a car still inside). Returns the
 * suggestions plus dismiss/ack (both drop the pending detection server-side).
 */
export function useCameraDetections(tenantId: string | null): CameraDetections {
  const [raw, setRaw] = useState<PendingDetection[]>([]);
  // Plates the operator already acted on — hidden immediately until the next
  // poll confirms the server dropped them (then pruned, so re-entries reappear).
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  // Normalised plates currently parked (no leftAt) for this tenant.
  const activePlates = useLiveQuery(async () => {
    if (!tenantId) return new Set<string>();
    const rows = await localDb.entries
      .where('tenantId')
      .equals(tenantId)
      .filter((e) => !e.leftAt)
      .toArray();
    return new Set(rows.map((e) => e.plate));
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`${CAMERA_BASE_URL}/detections/pending`);
        if (!res.ok) return;
        const data = (await res.json()) as PendingDetection[];
        if (!cancelled) setRaw(data);
      } catch {
        // Service unreachable — leave the last known list in place.
      }
    }
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Prune the "removed" set once the server stops returning those plates, so a
  // car that leaves and comes back later can be suggested again.
  useEffect(() => {
    setRemoved((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(raw.map((d) => d.text));
      const next = new Set([...prev].filter((p) => present.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [raw]);

  // Drop pending detections for plates already active in base (best effort).
  useEffect(() => {
    if (!activePlates) return;
    for (const d of raw) {
      if (activePlates.has(d.text)) void deletePending(d.text);
    }
  }, [raw, activePlates]);

  const detections = useMemo(() => {
    const active = activePlates ?? new Set<string>();
    return raw.filter((d) => !removed.has(d.text) && !active.has(d.text));
  }, [raw, removed, activePlates]);

  const remove = useCallback((plate: string) => {
    setRemoved((prev) => new Set(prev).add(plate));
    void deletePending(plate);
  }, []);

  return { detections, dismiss: remove, ack: remove };
}
