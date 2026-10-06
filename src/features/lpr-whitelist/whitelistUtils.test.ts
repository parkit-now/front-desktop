import { describe, expect, it } from 'vitest';
import {
  ignoredPlateState,
  isIgnoredPlate,
  normalizeIgnoredPlate,
  whitelistFormError,
} from './whitelistUtils';

describe('Lista blanca', () => {
  const rule = {
    plate: 'IAG574',
    active: true,
    validFrom: '2026-10-06',
    validUntil: '2026-10-06',
  };
  it('normaliza patente y compara sin coincidencias aproximadas', () => {
    expect(normalizeIgnoredPlate(' iag-_574 ')).toBe('IAG574');
    expect(
      isIgnoredPlate('iag-574', [rule], Date.parse('2026-10-06T12:00:00Z')),
    ).toBe(true);
    expect(
      isIgnoredPlate('IAG575', [rule], Date.parse('2026-10-06T12:00:00Z')),
    ).toBe(false);
  });
  it('incluye todo el día argentino, independientemente del huso del equipo', () => {
    expect(ignoredPlateState(rule, Date.parse('2026-10-06T02:59:59Z'))).toBe(
      'Programada',
    );
    expect(ignoredPlateState(rule, Date.parse('2026-10-06T03:00:00Z'))).toBe(
      'Vigente',
    );
    expect(ignoredPlateState(rule, Date.parse('2026-10-07T02:59:59Z'))).toBe(
      'Vigente',
    );
    expect(ignoredPlateState(rule, Date.parse('2026-10-07T03:00:00Z'))).toBe(
      'Vencida',
    );
  });
  it('ignora sólo reglas activas y no eliminadas; permite vigencia indefinida', () => {
    expect(isIgnoredPlate('IAG574', [{ plate: 'IAG574', active: true }])).toBe(
      true,
    );
    expect(isIgnoredPlate('IAG574', [{ ...rule, active: false }])).toBe(false);
    expect(
      isIgnoredPlate('IAG574', [{ ...rule, deletedAt: '2026-10-05' }]),
    ).toBe(false);
  });
  it('rechaza patentes vacías y períodos invertidos', () => {
    expect(whitelistFormError({ plate: ' --- ' })).not.toBeNull();
    expect(
      whitelistFormError({ ...rule, validUntil: '2026-10-05' }),
    ).not.toBeNull();
    expect(whitelistFormError(rule)).toBeNull();
  });
});
