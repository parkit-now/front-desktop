import { describe, expect, it } from 'vitest';
import { parsePlateBbox, plateOverlayStyle } from './plateBbox';

describe('parsePlateBbox', () => {
  it('acepta un recuadro válido', () => {
    expect(parsePlateBbox({ x: 0.41, y: 0.62, w: 0.09, h: 0.04 })).toEqual({
      x: 0.41,
      y: 0.62,
      w: 0.09,
      h: 0.04,
    });
  });

  it.each([
    ['fuera de rango por arriba', { x: 1.4, y: 0.1, w: 0.1, h: 0.1 }],
    ['negativo', { x: -0.1, y: 0.1, w: 0.1, h: 0.1 }],
    ['ancho cero', { x: 0.1, y: 0.1, w: 0, h: 0.1 }],
    ['alto cero', { x: 0.1, y: 0.1, w: 0.1, h: 0 }],
    ['incompleto', { x: 0.1, y: 0.1 }],
    ['strings', { x: '0.1', y: '0.1', w: '0.1', h: '0.1' }],
    ['no es objeto', 'nope'],
    ['nulo', null],
    ['ausente', undefined],
  ])('descarta %s', (_caso, valor) => {
    expect(parsePlateBbox(valor)).toBeUndefined();
  });

  it('descarta NaN e Infinity, que se cuelan como number', () => {
    expect(parsePlateBbox({ x: NaN, y: 0.1, w: 0.1, h: 0.1 })).toBeUndefined();
    expect(
      parsePlateBbox({ x: Infinity, y: 0.1, w: 0.1, h: 0.1 }),
    ).toBeUndefined();
  });
});

describe('plateOverlayStyle', () => {
  it('traduce fracciones a porcentajes sin tocar píxeles', () => {
    // Que sean porcentajes es lo que hace que el recuadro caiga bien sin
    // importar a qué tamaño se renderice la imagen.
    expect(plateOverlayStyle({ x: 0.25, y: 0.5, w: 0.1, h: 0.2 })).toEqual({
      left: '25%',
      top: '50%',
      width: '10%',
      height: '20%',
    });
  });
});
