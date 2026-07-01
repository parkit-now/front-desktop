import { describe, expect, it } from 'vitest';
import type { LocalLprDetectionEvent } from '../../lib/db/localDb';
import { cameraDetectionTestUtils } from './useCameraDetections';

const { keeperByPlate, normalisePlate, suppressionReason } =
  cameraDetectionTestUtils;

function event(
  id: string,
  plate: string,
  overrides: Partial<LocalLprDetectionEvent> = {},
): LocalLprDetectionEvent {
  const now = '2026-07-01T12:00:00.000Z';
  return {
    id,
    tenantId: 'tenant-1',
    cameraId: 'cam-01',
    location: 'entrada',
    firstSeenAt: now,
    lastSeenAt: now,
    rawText: plate,
    normalizedText: normalisePlate(plate),
    displayPlate: plate,
    confidence: 0.82,
    formatValid: true,
    formatType: 'argentina_old',
    qualityStatus: 'valid_high',
    status: 'pending',
    candidates: [],
    version: 1,
    syncSeq: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('camera detection suppression', () => {
  it('suppresses a plate that is already active in base', () => {
    const detection = event('event-1', 'ABC123');
    const keepers = keeperByPlate([detection]);

    expect(
      suppressionReason(
        detection,
        keepers,
        new Set(['ABC123']),
        new Set<string>(),
      ),
    ).toBe('suppressed_active_entry');
  });

  it('keeps the strongest pending event and suppresses duplicate pendings', () => {
    const weak = event('event-1', 'XEY123', {
      confidence: 0.61,
      qualityStatus: 'valid_low',
    });
    const strong = event('event-2', 'XEY123', {
      confidence: 0.91,
      qualityStatus: 'valid_high',
    });
    const keepers = keeperByPlate([weak, strong]);

    expect(
      suppressionReason(strong, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
    expect(
      suppressionReason(weak, keepers, new Set<string>(), new Set<string>()),
    ).toBe('suppressed_pending_event');
  });

  it('suppresses a plate that was recently paid and exited', () => {
    const detection = event('event-1', 'AB123CD', {
      formatType: 'argentina_mercosur',
    });
    const keepers = keeperByPlate([detection]);

    expect(
      suppressionReason(
        detection,
        keepers,
        new Set<string>(),
        new Set(['AB123CD']),
      ),
    ).toBe('suppressed_recent_exit');
  });

  it('keeps invalid or low-confidence LPR events actionable when not otherwise suppressed', () => {
    const detection = event('event-1', 'AB1', {
      confidence: 0.31,
      formatValid: false,
      formatType: 'unknown',
      qualityStatus: 'invalid_format',
    });
    const keepers = keeperByPlate([detection]);

    expect(
      suppressionReason(
        detection,
        keepers,
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBeNull();
  });
});
