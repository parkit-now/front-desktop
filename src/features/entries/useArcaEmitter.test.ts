import { describe, expect, it } from 'vitest';
import { parseEmitterCache, toArcaEmitter } from './useArcaEmitter';

const NOW = new Date('2026-09-25T12:00:00.000Z');

describe('toArcaEmitter', () => {
  it('vinculada con certificado vigente → factura normal', () => {
    expect(
      toArcaEmitter(
        {
          status: 'linked',
          condicionIva: 'responsable_inscripto',
          certExpiresAt: '2027-01-01T00:00:00.000Z',
        },
        NOW,
      ),
    ).toEqual({ condicionIva: 'responsable_inscripto', certExpired: false });
  });

  it('cert_expired, o linked con el certificado ya vencido → pausada', () => {
    expect(
      toArcaEmitter(
        { status: 'cert_expired', condicionIva: 'monotributo' },
        NOW,
      )?.certExpired,
    ).toBe(true);
    expect(
      toArcaEmitter(
        {
          status: 'linked',
          condicionIva: 'monotributo',
          certExpiresAt: '2026-09-24T00:00:00.000Z',
        },
        NOW,
      )?.certExpired,
    ).toBe(true);
  });

  it('sin cuenta o con el wizard a medias → no factura', () => {
    expect(toArcaEmitter(null, NOW)).toBeNull();
    expect(
      toArcaEmitter(
        { status: 'pending_sales_point', condicionIva: 'monotributo' },
        NOW,
      ),
    ).toBeNull();
  });
});

describe('parseEmitterCache', () => {
  it('lee el formato nuevo y el viejo (sólo la condición)', () => {
    expect(
      parseEmitterCache(
        JSON.stringify({ condicionIva: 'monotributo', certExpired: true }),
      ),
    ).toEqual({ condicionIva: 'monotributo', certExpired: true });
    expect(parseEmitterCache('responsable_inscripto')).toEqual({
      condicionIva: 'responsable_inscripto',
      certExpired: false,
    });
    expect(parseEmitterCache('basura')).toBeNull();
  });
});
