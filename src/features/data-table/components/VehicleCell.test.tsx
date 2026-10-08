import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VehicleCell, vehicleColorSwatch } from './VehicleCell';

describe('VehicleCell', () => {
  it('muestra marca y color con un círculo cuando falta el modelo', () => {
    const html = renderToStaticMarkup(
      <VehicleCell brand="Toyota" color="Blanco" />,
    );
    expect(html).toContain('Toyota');
    expect(html).toContain('Blanco');
    expect(html).toContain('dt-vehicle-swatch');
    expect(html).toContain('background-color:#ffffff');
    expect(html).not.toContain('>—</span>');
  });

  it('reconoce colores con acentos y conserva los desconocidos como texto', () => {
    expect(vehicleColorSwatch(' Marrón ')).toBe('#795548');
    expect(vehicleColorSwatch('Azul oscuro')).toBe('#3264ae');
    expect(vehicleColorSwatch('Perlado')).toBeNull();
    expect(renderToStaticMarkup(<VehicleCell color="Perlado" />)).toContain(
      'Perlado',
    );
  });
});
