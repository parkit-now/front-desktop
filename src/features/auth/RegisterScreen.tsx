import { useState, type FormEvent } from 'react';
import { registerWithEmail } from '../../lib/supabase/session';
import { getErrorMessage } from './errors';

type Props = {
  onSwitchToLogin: () => void;
};

export function RegisterScreen({ onSwitchToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setMessage('');
    setPending(true);
    try {
      await registerWithEmail(email, password);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <h2>Crear cuenta</h2>

      <form
        className="auth-form"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <input
          type="email"
          aria-label="Email"
          autoComplete="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          required
          placeholder="Email"
        />

        <input
          type="password"
          aria-label="Contrasena"
          autoComplete="new-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
          required
          minLength={8}
          placeholder="Contrasena"
        />

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
