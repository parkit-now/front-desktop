type Props = {
  brand?: string | null;
  model?: string | null;
};

export function VehicleCell({ brand, model }: Props) {
  return (
    <div className="dt-vehicle-cell">
      <strong>{brand || '—'}</strong>
      <span>{model || '—'}</span>
    </div>
  );
}
