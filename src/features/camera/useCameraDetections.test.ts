import { describe, expect, it, vi } from 'vitest';
import type { LocalLprDetectionEvent } from '../../lib/db/localDb';
import { cameraDetectionTestUtils } from './useCameraDetections';

const {
  CAMERA_KNOWN_PLATES_TTL_MS,
  KNOWN_PLATES_PUSH_MS,
  keeperByPlate,
  normalisePlate,
  parseCameraEventMessage,
  plateDistance,
  platesToSuppress,
  pushKnownPlatesSnapshot,
  shouldResendResolution,
  suppressionReason,
} = cameraDetectionTestUtils;

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

  it('suppresses recent fuzzy OCR variants of the same pending vehicle', () => {
    const weak = event('event-1', 'AH000BD', {
      confidence: 0.78,
      lastSeenAt: '2026-07-01T12:00:00.000Z',
    });
    const strong = event('event-2', 'AH000DD', {
      confidence: 0.91,
      lastSeenAt: '2026-07-01T12:00:08.000Z',
    });
    const keepers = keeperByPlate([weak, strong]);

    expect(plateDistance('AH000BD', 'AH000DD')).toBeLessThanOrEqual(1);
    expect(
      suppressionReason(strong, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
    expect(
      suppressionReason(weak, keepers, new Set<string>(), new Set<string>()),
    ).toBe('suppressed_pending_event');
  });

  it('does not suppress a blank card behind a readable plate by time alone', () => {
    const strong = event('event-1', 'AH000DD', {
      confidence: 0.88,
      qualityStatus: 'valid_high',
      lastSeenAt: '2026-07-01T12:00:00.000Z',
    });
    const blank = event('event-2', '', {
      confidence: 0.45,
      displayPlate: undefined,
      normalizedText: undefined,
      formatValid: false,
      formatType: 'unknown',
      qualityStatus: 'low_confidence',
      lastSeenAt: '2026-07-01T12:00:05.000Z',
    });
    const keepers = keeperByPlate([strong, blank]);

    expect(
      suppressionReason(strong, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
    expect(
      suppressionReason(blank, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
  });

  it('suppresses consecutive blank cards in a short window', () => {
    const weak = event('event-1', '', {
      confidence: 0.28,
      displayPlate: undefined,
      normalizedText: undefined,
      formatValid: false,
      formatType: 'unknown',
      qualityStatus: 'low_confidence',
      lastSeenAt: '2026-07-01T12:00:00.000Z',
    });
    const stronger = event('event-2', '', {
      confidence: 0.46,
      displayPlate: undefined,
      normalizedText: undefined,
      formatValid: false,
      formatType: 'unknown',
      qualityStatus: 'low_confidence',
      lastSeenAt: '2026-07-01T12:00:08.000Z',
    });
    const keepers = keeperByPlate([weak, stronger]);

    expect(
      suppressionReason(
        stronger,
        keepers,
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBeNull();
    expect(
      suppressionReason(weak, keepers, new Set<string>(), new Set<string>()),
    ).toBe('suppressed_pending_event');
  });

  it('does not use low-confidence text as a bridge between different plates', () => {
    const first = event('event-1', 'AI003UM', {
      confidence: 0.86,
      qualityStatus: 'valid_high',
      lastSeenAt: '2026-07-01T12:00:00.000Z',
    });
    const weakText = event('event-2', 'SDDM601G', {
      confidence: 0.46,
      formatValid: false,
      formatType: 'unknown',
      qualityStatus: 'low_confidence',
      lastSeenAt: '2026-07-01T12:00:06.000Z',
    });
    const keepers = keeperByPlate([first, weakText]);

    expect(
      suppressionReason(first, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
    expect(
      suppressionReason(
        weakText,
        keepers,
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBeNull();
  });

  it('keeps a blank weak card when it could belong to more than one plate', () => {
    const first = event('event-1', 'AA021ID', {
      lastSeenAt: '2026-07-01T12:00:00.000Z',
    });
    const second = event('event-2', 'AI003UM', {
      lastSeenAt: '2026-07-01T12:00:05.000Z',
    });
    const ambiguous = event('event-3', '', {
      confidence: 0.28,
      displayPlate: undefined,
      normalizedText: undefined,
      formatValid: false,
      formatType: 'unknown',
      qualityStatus: 'low_confidence',
      lastSeenAt: '2026-07-01T12:00:10.000Z',
    });
    const keepers = keeperByPlate([first, second, ambiguous]);

    expect(
      suppressionReason(
        ambiguous,
        keepers,
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBeNull();
  });

  it('does not suppress similar plates after the duplicate window', () => {
    const first = event('event-1', 'AH000BD', {
      lastSeenAt: '2026-07-01T12:00:00.000Z',
    });
    const later = event('event-2', 'AH000DD', {
      lastSeenAt: '2026-07-01T12:04:00.000Z',
    });
    const keepers = keeperByPlate([first, later]);

    expect(
      suppressionReason(first, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
    expect(
      suppressionReason(later, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
  });

  it('does not suppress similar plates from another camera', () => {
    const first = event('event-1', 'AH000BD');
    const otherCamera = event('event-2', 'AH000DD', { cameraId: 'cam-02' });
    const keepers = keeperByPlate([first, otherCamera]);

    expect(
      suppressionReason(first, keepers, new Set<string>(), new Set<string>()),
    ).toBeNull();
    expect(
      suppressionReason(
        otherCamera,
        keepers,
        new Set<string>(),
        new Set<string>(),
      ),
    ).toBeNull();
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

describe('parseCameraEventMessage', () => {
  it('parsea un evento SSE de detección', () => {
    expect(
      parseCameraEventMessage(
        JSON.stringify({ eventId: 'lpr-1', normalizedText: 'AA123BB' }),
      ),
    ).toMatchObject({ eventId: 'lpr-1', normalizedText: 'AA123BB' });
  });

  it('ignora mensajes SSE malformados', () => {
    expect(parseCameraEventMessage('{')).toBeNull();
    expect(parseCameraEventMessage('null')).toBeNull();
  });
});

describe('shouldResendResolution', () => {
  it('reenvía cuando el servicio todavía la cree pendiente y acá ya se resolvió', () => {
    // El aviso original se perdió porque `patchCameraEvent` es best-effort y
    // el servicio podía estar reiniciándose. Nada lo reintentaba, y esas filas
    // se acumulaban `pending` para siempre.
    expect(
      shouldResendResolution(
        event('e1', 'AB123CD', { status: 'dismissed' }),
        'pending',
      ),
    ).toBe(true);
  });

  it.each([
    'registered',
    'suppressed_active_entry',
    'suppressed_recent_exit',
  ] as const)('también reenvía un estado %s', (status) => {
    expect(
      shouldResendResolution(event('e1', 'AB123CD', { status }), 'pending'),
    ).toBe(true);
  });

  it('no reenvía si acá también sigue pendiente', () => {
    expect(
      shouldResendResolution(
        event('e1', 'AB123CD', { status: 'pending' }),
        'pending',
      ),
    ).toBe(false);
  });

  it('no reenvía si el servicio ya sabe que está resuelta', () => {
    expect(
      shouldResendResolution(
        event('e1', 'AB123CD', { status: 'dismissed' }),
        'dismissed',
      ),
    ).toBe(false);
  });

  it('no reenvía una detección que nunca vimos', () => {
    expect(shouldResendResolution(undefined, 'pending')).toBe(false);
  });
});

describe('platesToSuppress', () => {
  it('junta los autos adentro con los que ya tienen tarjeta', () => {
    const plates = platesToSuppress(new Set(['AA111AA']), [
      event('e1', 'BB222BB'),
    ]);
    expect(plates.sort()).toEqual(['AA111AA', 'BB222BB']);
  });

  it('no repite una patente que está en los dos lados', () => {
    // El servicio compara por igualdad exacta; los duplicados sólo inflan el
    // payload que viaja cada 10 segundos.
    expect(
      platesToSuppress(new Set(['AA111AA']), [event('e1', 'AA111AA')]),
    ).toEqual(['AA111AA']);
  });

  it('ignora las tarjetas que ya no están pendientes', () => {
    expect(
      platesToSuppress(new Set(), [
        event('e1', 'BB222BB', { status: 'dismissed' }),
      ]),
    ).toEqual([]);
  });

  it('sin autos adentro ni tarjetas no suprime nada', () => {
    // Es el estado seguro: ante la duda, guardar de más.
    expect(platesToSuppress(new Set(), [])).toEqual([]);
  });

  it('normaliza autos activos y pendientes antes de suprimir', () => {
    const plates = platesToSuppress(new Set(['aa 111 aa']), [
      event('e1', 'BB-222-BB', { normalizedText: undefined }),
    ]);
    expect(plates).toEqual(['AA111AA', 'BB222BB']);
  });

  it('envía el snapshot normalizado al servicio local de cámara', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    await pushKnownPlatesSnapshot(
      new Set(['aa 111 aa']),
      [event('e1', 'BB-222-BB', { normalizedText: undefined })],
      fetchMock,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/known-plates'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ plates: ['AA111AA', 'BB222BB'] }),
      }),
    );
  });

  it('reenvía known-plates holgadamente antes del TTL del servicio', () => {
    expect(KNOWN_PLATES_PUSH_MS).toBeLessThan(CAMERA_KNOWN_PLATES_TTL_MS / 2);
  });
});
