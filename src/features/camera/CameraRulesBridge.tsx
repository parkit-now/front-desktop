import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { localDb } from '../../lib/db/localDb';
import { CAMERA_BASE_URL } from '../../lib/camera/constants';
import { KNOWN_PLATES_PUSH_MS, platesToSuppress } from './useCameraDetections';
import { useCameraTestingMode } from './testingMode';

export function CameraRulesBridge({ tenantId }: { tenantId: string | null }) {
  const testingMode = useCameraTestingMode();
  const snapshot = useLiveQuery(async () => {
    if (!tenantId) return { plates: [], ignoredPlates: [] };
    return localDb.transaction(
      'r',
      localDb.entries,
      localDb.lprDetectionEvents,
      localDb.lprIgnoredPlates,
      async () => {
        const entries = await localDb.entries
          .where('tenantId')
          .equals(tenantId)
          .filter((row) => !row.leftAt && !row.deletedAt)
          .toArray();
        const pending = await localDb.lprDetectionEvents
          .where('[tenantId+status]')
          .equals([tenantId, 'pending'])
          .toArray();
        const rules = await localDb.lprIgnoredPlates
          .where('tenantId')
          .equals(tenantId)
          .filter((row) => !row.deletedAt && row.active)
          .toArray();
        return {
          plates: platesToSuppress(
            new Set(entries.map((row) => row.plate)),
            pending,
          ),
          ignoredPlates: rules.map((row) => ({
            plate: row.plate,
            validFrom: row.validFrom ?? null,
            validUntil: row.validUntil ?? null,
          })),
        };
      },
    );
  }, [tenantId]);
  useEffect(() => {
    if (!snapshot) return;
    const controller = new AbortController();
    let inFlight = false;
    async function push() {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        await fetch(`${CAMERA_BASE_URL}/known-plates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(5000),
          ]),
          body: JSON.stringify({
            tenantId,
            plates: testingMode ? [] : snapshot!.plates,
            ignoredPlates: snapshot!.ignoredPlates,
            testingMode,
          }),
        });
      } catch {
        /* Retried periodically when the service returns. */
      } finally {
        inFlight = false;
      }
    }
    void push();
    const interval = setInterval(() => void push(), KNOWN_PLATES_PUSH_MS);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [tenantId, snapshot, testingMode]);
  return null;
}
