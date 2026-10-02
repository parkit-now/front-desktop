import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordInput({ className, ...inputProps }: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input-wrap">
      <input
        {...inputProps}
        type={visible ? 'text' : 'password'}
        className={className}
      />
      <button
        type="button"
        className="password-visibility-button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-pressed={visible}
      >
        {visible ? (
          <EyeOff size={18} aria-hidden="true" />
        ) : (
          <Eye size={18} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
