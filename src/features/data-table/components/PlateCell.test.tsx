import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { classifyPlate, PlateCell } from './PlateCell';

describe('PlateCell', () => {
  it.each([
    ['AB123CD', 'mercosur', 'car'],
    ['A123BCD', 'mercosur', 'moto'],
    ['ABC123', 'legacy', 'car'],
    ['123ABC', 'legacy', 'moto'],
    ['TEST123', 'generic', null],
  ] as const)('clasifica %s como %s / %s', (raw, kind, vehicle) => {
    expect(classifyPlate(raw)).toMatchObject({ kind, vehicle });
  });

  it('tolera separadores solo para clasificar y muestra el dominio normalizado', () => {
    const html = renderToStaticMarkup(<PlateCell plate="ab-123-cd" />);
    expect(html).toContain('dt-plate--mercosur');
    expect(html).toContain('AB123CD');
  });

  it('mantiene un diseño neutro para formatos desconocidos', () => {
    const html = renderToStaticMarkup(<PlateCell plate="PROVISORIA 1" />);
    expect(html).toContain('dt-plate--generic');
    expect(html).toContain('PROVISORIA 1');
    expect(html).not.toContain('dt-plate__number--spread');
  });

  it('reparte los caracteres cortos sin perder la lectura de la patente completa', () => {
    const html = renderToStaticMarkup(<PlateCell plate="309" />);
    expect(html).toContain('dt-plate__number--spread');
    expect(html).toContain('<span>3</span><span>0</span><span>9</span>');
    expect(html).toContain('aria-label="Patente otro formato: 309"');
  });

  it.each([
    ['AB123CD', ['AB', '123', 'CD']],
    ['A123BCD', ['A', '123', 'BCD']],
    ['ABC123', ['ABC', '123']],
    ['123ABC', ['123', 'ABC']],
  ])('separa los bloques oficiales de %s', (plate, groups) => {
    const html = renderToStaticMarkup(<PlateCell plate={plate} />);
    expect(html).toContain('dt-plate__number--official');
    expect(html).toContain(
      groups.map((group) => `<span>${group}</span>`).join(''),
    );
  });
});
