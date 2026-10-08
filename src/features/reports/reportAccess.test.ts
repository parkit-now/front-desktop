import { describe, expect, it } from 'vitest';
import { hasVerifiedReportAccess } from './reportAccess';

describe('acceso a informes del dueño', () => {
  const verified = {
    token: 'token-vigente',
    userId: 'dueño',
    tenantIds: ['playa-1'],
  };

  it('exige una membresía de dueño verificada para el estacionamiento activo', () => {
    expect(
      hasVerifiedReportAccess(verified, 'token-vigente', 'dueño', 'playa-1'),
    ).toBe(true);
    expect(
      hasVerifiedReportAccess(verified, 'token-vigente', 'dueño', 'playa-2'),
    ).toBe(false);
    expect(
      hasVerifiedReportAccess(verified, 'token-vigente', 'dueño', null),
    ).toBe(false);
  });

  it('no confía en verificaciones de otra sesión ni en el perfil local', () => {
    expect(
      hasVerifiedReportAccess(null, 'token-vigente', 'dueño', 'playa-1'),
    ).toBe(false);
    expect(
      hasVerifiedReportAccess(verified, 'otro-token', 'dueño', 'playa-1'),
    ).toBe(false);
    expect(
      hasVerifiedReportAccess(verified, 'token-vigente', 'admin', 'playa-1'),
    ).toBe(false);
  });
});
