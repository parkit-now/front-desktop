import type { LocalLprDetectionEvent } from '../../lib/db/localDb';

export function hasDetectionImage(
  detection:
    | Pick<
        LocalLprDetectionEvent,
        'bestCaptureId' | 'imageStoragePath' | 'imageDeletedAt'
      >
    | null
    | undefined,
): boolean {
  return Boolean(
    detection &&
    !detection.imageDeletedAt &&
    (detection.bestCaptureId || detection.imageStoragePath),
  );
}
