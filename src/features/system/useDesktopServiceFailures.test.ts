import { describe, expect, it } from 'vitest';
import {
  hasDesktopServiceFailure,
  mergeDesktopServiceFailures,
  normalizeDesktopServiceFailures,
} from './useDesktopServiceFailures';

describe('desktop service failures helpers', () => {
  it('keeps known initial failures', () => {
    expect(normalizeDesktopServiceFailures(['lpr-service'])).toEqual([
      'lpr-service',
    ]);
  });

  it('adds crashed services without dropping previous failures', () => {
    const failures = mergeDesktopServiceFailures(
      ['lpr-service'],
      ['camera-service'],
    );

    expect(failures).toEqual(['lpr-service', 'camera-service']);
    expect(hasDesktopServiceFailure(failures, 'camera-service')).toBe(true);
  });

  it('ignores unknown services and removes duplicates', () => {
    expect(
      mergeDesktopServiceFailures(
        ['lpr-service'],
        ['not-a-service', 'lpr-service', 'camera-service', 'camera-service'],
      ),
    ).toEqual(['lpr-service', 'camera-service']);
  });
});
