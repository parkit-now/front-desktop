import { useState, type FormEvent } from 'react';
import { registerWithEmail } from '../../lib/supabase/session';
import type { RegisterRole } from '../../lib/api/auth';
import { getErrorMessage } from './errors';

const ROLE_OPTIONS: Array<{ value: RegisterRole; label: string }> = [
  { value: 'driver', label: 'Conductor' },
  { value: 'operator', label: 'Operador' },
  { value: 'owner', label: 'Dueno de playa' },
];

type Props = {
  onSwitchToLogin: () => void;
};

export function RegisterScreen({ onSwitchToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<RegisterRole>('driver');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setMessage('');
    setPending(true);
    try {
      await registerWithEmail(email, password, role);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2>Crear cuenta</h2>
      <p className="muted">Completa tus datos para empezar.</p>

      <form
        className="auth-form"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label className="form-field">
          <span className="form-label">Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
            required
            placeholder="jane.doe@parkit.com"
          />
        </label>

        <label className="form-field">
          <span className="form-label">Contrasena</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
            minLength={8}
            placeholder="Minimo 8 caracteres"
          />
        </label>

        <label className="form-field">
          <span className="form-label">Rol</span>
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value as RegisterRole);
            }}
            required
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? 'Creando cuenta...' : 'Crear cuenta'}
        </button>
      </form>

      <p className="form-helper">
        Ya tenes cuenta?{' '}
        <button
          type="button"
          className="link-button"
          onClick={onSwitchToLogin}
          disabled={pending}
        >
          Ingresar
        </button>
      </p>

      {message ? <p className="error-banner">{message}</p> : null}
    </>
  );
}
