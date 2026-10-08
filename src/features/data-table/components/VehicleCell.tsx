type Props = {
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  colors?: readonly string[];
};

const COLOR_SWATCHES: Record<string, string> = {
  AMARILLO: '#efcf36',
  AZUL: '#3264ae',
  BEIGE: '#d9c9a9',
  BLANCO: '#ffffff',
  BORDO: '#842d43',
  CELESTE: '#77bde2',
  CHAMPAGNE: '#d9ca9b',
  CREMA: '#f0e9cf',
  GRIS: '#8d939c',
  LADRILLO: '#ba6550',
  LILA: '#b9a2d8',
  MARRON: '#795548',
  NARANJA: '#ed8b35',
  NEGRO: '#252a32',
  ORO: '#c5a34a',
  PLATA: '#c5cbd3',
  ROJO: '#c74343',
  ROSA: '#df91b3',
  TAXI: '#efcf36',
  VERDE: '#4b8c61',
  VIOLETA: '#8168ac',
};

export function vehicleColorSwatch(color: string): string | null {
  const key = color
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[\s/-]/)[0];
  return COLOR_SWATCHES[key] ?? null;
}

export function VehicleCell({ brand, model, color, colors }: Props) {
  const visibleColors = [
    ...new Set(
      (colors ?? (color ? [color] : []))
        .map((value) => value.trim())
        .filter((value) => value && value !== '—'),
    ),
  ];

  return (
    <div className="dt-vehicle-cell">
      <strong>{brand || '—'}</strong>
      {model ? (
        <span>{model}</span>
      ) : visibleColors.length === 0 ? (
        <span>—</span>
      ) : null}
      {visibleColors.length > 0 ? (
        <div className="dt-vehicle-colors">
          {visibleColors.map((value) => (
            <span className="dt-vehicle-color" key={value}>
              <span
                className="dt-vehicle-swatch"
                style={{
                  backgroundColor: vehicleColorSwatch(value) ?? 'transparent',
                }}
                aria-hidden="true"
              />
              {value}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
