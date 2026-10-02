import { describe, expect, it } from 'vitest';
import { validateFullName } from './validation';

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
