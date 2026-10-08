import './plateCell.css';

export type PlateKind = 'mercosur' | 'legacy' | 'generic';
export type PlateVehicle = 'car' | 'moto' | null;

export function classifyPlate(raw: string): {
  kind: PlateKind;
  vehicle: PlateVehicle;
  label: string;
} {
  const label = raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]/g, '');
  if (/^[A-Z]{2}[0-9]{3}[A-Z]{2}$/.test(label)) {
    return { kind: 'mercosur', vehicle: 'car', label };
  }
  if (/^[A-Z][0-9]{3}[A-Z]{3}$/.test(label)) {
    return { kind: 'mercosur', vehicle: 'moto', label };
  }
  if (/^[A-Z]{3}[0-9]{3}$/.test(label)) {
    return { kind: 'legacy', vehicle: 'car', label };
  }
  if (/^[0-9]{3}[A-Z]{3}$/.test(label)) {
    return { kind: 'legacy', vehicle: 'moto', label };
  }
  return { kind: 'generic', vehicle: null, label: raw.trim() };
}

export function PlateCell({ plate }: { plate: string }) {
  const { kind, vehicle, label } = classifyPlate(plate);
  if (!label || label === '-') return <span className="dt-plate-empty">—</span>;

  const format =
    kind === 'mercosur'
      ? 'Mercosur'
      : kind === 'legacy'
        ? 'Anterior'
        : 'Otro formato';
  const description = `Patente ${format.toLowerCase()}${vehicle ? ` de ${vehicle === 'moto' ? 'moto' : 'auto'}` : ''}: ${label}`;
  const glyphs = Array.from(label);
  const groups =
    kind === 'mercosur'
      ? vehicle === 'moto'
        ? [label.slice(0, 1), label.slice(1, 4), label.slice(4)]
        : [label.slice(0, 2), label.slice(2, 5), label.slice(5)]
      : kind === 'legacy'
        ? [label.slice(0, 3), label.slice(3)]
        : null;
  const spreadLabel =
    kind === 'generic' && glyphs.length <= 8 && !/\s/.test(label);
  return (
    <span
      className={`dt-plate dt-plate--${kind}${vehicle === 'moto' ? ' dt-plate--moto' : ''}`}
      role="img"
      aria-label={description}
      title={description}
    >
      {kind !== 'generic' ? (
        <span className="dt-plate__band" aria-hidden="true">
          <span>ARGENTINA</span>
          {kind === 'mercosur' ? <span className="dt-plate__flag" /> : null}
        </span>
      ) : null}
      <span
        className={`dt-plate__number${groups ? ' dt-plate__number--official' : ''}${spreadLabel ? ' dt-plate__number--spread' : ''}`}
      >
        {groups
          ? groups.map((group, index) => <span key={index}>{group}</span>)
          : spreadLabel
            ? glyphs.map((glyph, index) => <span key={index}>{glyph}</span>)
            : label}
      </span>
    </span>
  );
}
