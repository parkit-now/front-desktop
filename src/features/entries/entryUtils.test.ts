import { describe, expect, it } from 'vitest';
import { computeChange, isCashMethod } from './entryUtils';

describe('entryUtils', () => {
  describe('computeChange', () => {
    it('returns the difference when received exceeds the amount due', () => {
      expect(computeChange(1500, 2000)).toBe(500);
    });

    it('returns zero when received equals the amount due', () => {
      expect(computeChange(1500, 1500)).toBe(0);
    });

    it('returns zero when received is below the amount due', () => {
      expect(computeChange(1500, 1000)).toBe(0);
    });
  });

  describe('isCashMethod', () => {
    it('matches cash regardless of casing', () => {
      expect(isCashMethod('Efectivo')).toBe(true);
      expect(isCashMethod('EFECTIVO')).toBe(true);
    });

    it('does not match other methods', () => {
      expect(isCashMethod('Tarjeta')).toBe(false);
      expect(isCashMethod('Transferencia')).toBe(false);
    });
  });
});
