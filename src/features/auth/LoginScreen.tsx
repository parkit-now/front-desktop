import { useState, type FormEvent } from 'react';
import {
  signInWithEmail,
  signInWithProvider,
} from '../../lib/supabase/session';
import { getErrorMessage } from './errors';
import { ProviderIcon, type SocialProvider } from './ProviderIcon';

type OAuthOption = {
  provider: SocialProvider;
  label: string;
};

const OAUTH_OPTIONS: OAuthOption[] = [
  { provider: 'google', label: 'Continuar con Google' },
  { provider: 'github', label: 'Continuar con GitHub' },
];

type Props = {
  onSwitchToRegister: () => void;
};

export function LoginScreen({ onSwitchToRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pendingEmail, setPendingEmail] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(
    null,
  );
  const [message, setMessage] = useState('');

  async function handleEmailSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setMessage('');
    setPendingEmail(true);
    try {
      await signInWithEmail(email, password);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setPendingEmail(false);
    }
  }

  async function handleProvider(provider: SocialProvider) {
    setMessage('');
    setPendingProvider(provider);
    try {
      await signInWithProvider(provider);
    } catch (error) {
      setMessage(getErrorMessage(error));
      setPendingProvider(null);
    }
  }

  const anyPending = pendingEmail || pendingProvider !== null;

  return (
    <>
      <h2>Iniciar sesion</h2>
      <p className="muted">Ingresa con tu correo o un proveedor.</p>

      <form
        className="auth-form"
        onSubmit={(event) => {
          void handleEmailSubmit(event);
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
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            required
            minLength={8}
            placeholder="Minimo 8 caracteres"
          />
        </label>

        <button type="submit" className="primary-button" disabled={anyPending}>
          {pendingEmail ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>

      <p className="form-helper">
        No tenes cuenta?{' '}
        <button
          type="button"
          className="link-button"
          onClick={onSwitchToRegister}
          disabled={anyPending}
        >
          Crear una
        </button>
      </p>

      <div className="auth-divider" role="presentation">
        <span>o continuar con</span>
      </div>

      <div className="oauth-list">
        {OAUTH_OPTIONS.map((option) => (
          <button
            key={option.provider}
            type="button"
            className="oauth-button"
            onClick={() => {
              void handleProvider(option.provider);
            }}
            disabled={anyPending}
          >
            <ProviderIcon provider={option.provider} />
            <span>
              {pendingProvider === option.provider
                ? 'Redirigiendo...'
                : option.label}
            </span>
          </button>
        ))}
      </div>

      {message ? <p className="error-banner">{message}</p> : null}
    </>
  );
}
