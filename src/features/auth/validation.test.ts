import { describe, expect, it } from 'vitest';
import { validateFullName, validatePasswordConfirmation } from './validation';

describe('validateFullName', () => {
  it('rechaza vacío y solo espacios', () => {
    expect(validateFullName('')).toBe('Este campo es obligatorio.');
    expect(validateFullName('   ')).toBe('Este campo es obligatorio.');
  });

  it('rechaza menos de dos palabras', () => {
    expect(validateFullName('Juan')).toBe('Ingresá tu nombre y apellido');
    expect(validateFullName('  Juan  ')).toBe('Ingresá tu nombre y apellido');
  });

  it('acepta nombre y apellido', () => {
    expect(validateFullName('Juan Pérez')).toBeNull();
    expect(validateFullName('  Ana   María  López ')).toBeNull();
  });
});

describe('validatePasswordConfirmation', () => {
  it('rechaza vacío', () => {
    expect(validatePasswordConfirmation('abcdefgh', '')).toBe(
      'Este campo es obligatorio.',
    );
  });

  it('rechaza si no coincide', () => {
    expect(validatePasswordConfirmation('abcdefgh', 'abcdefgx')).toBe(
      'Las contraseñas no coinciden',
    );
  });

  it('acepta si coincide', () => {
    expect(validatePasswordConfirmation('abcdefgh', 'abcdefgh')).toBeNull();
  });
});
