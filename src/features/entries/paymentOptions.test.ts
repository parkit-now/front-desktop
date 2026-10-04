import { describe, expect, it } from 'vitest';
import {
  dedupePaymentMethods,
  needsPaymentPlaceholder,
} from './paymentOptions';

const methods = [{ id: 'a' }, { id: 'b' }];

describe('dedupePaymentMethods', () => {
  it('quita repetidos por id conservando el orden', () => {
    expect(
      dedupePaymentMethods([{ id: 'a' }, { id: 'b' }, { id: 'a' }]),
    ).toEqual(methods);
  });
});

describe('needsPaymentPlaceholder', () => {
  it('no hace falta si el medio de la línea está en las opciones', () => {
    expect(needsPaymentPlaceholder('a', methods)).toBe(false);
  });
  it('hace falta sin id', () => {
    expect(needsPaymentPlaceholder(undefined, methods)).toBe(true);
    expect(needsPaymentPlaceholder(null, methods)).toBe(true);
    expect(needsPaymentPlaceholder('', methods)).toBe(true);
  });
  it('hace falta si el medio fue borrado o deshabilitado', () => {
    expect(needsPaymentPlaceholder('zzz', methods)).toBe(true);
  });
});
