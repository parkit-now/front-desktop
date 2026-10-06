interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  'aria-label': ariaLabel,
}: SwitchProps) {
  return (
    <label className="ui-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={ariaLabel}
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-switch-track" aria-hidden="true">
        <span className="ui-switch-thumb" />
      </span>
      {label ? <span className="ui-switch-label">{label}</span> : null}
    </label>
  );
}
