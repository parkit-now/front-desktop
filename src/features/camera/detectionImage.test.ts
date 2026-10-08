import { describe, expect, it } from 'vitest';
import { hasDetectionImage } from './detectionImage';

describe('hasDetectionImage', () => {
  it('reconoce la captura local o la copia del backend', () => {
    expect(hasDetectionImage({ bestCaptureId: 'capture-1' })).toBe(true);
    expect(hasDetectionImage({ imageStoragePath: 'tenant/event.jpg' })).toBe(
      true,
    );
  });

  it('no ofrece fotos inexistentes o vencidas', () => {
    expect(hasDetectionImage(null)).toBe(false);
    expect(hasDetectionImage({})).toBe(false);
    expect(
      hasDetectionImage({
        bestCaptureId: 'capture-1',
        imageStoragePath: 'tenant/event.jpg',
        imageDeletedAt: '2026-10-08T12:00:00.000Z',
      }),
    ).toBe(false);
  });
});
