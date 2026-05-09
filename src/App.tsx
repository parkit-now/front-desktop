import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import {
  getSession,
  onSessionChange,
  signInWithProvider,
  signOut,
} from './lib/supabase/session';

type SocialProvider = 'google' | 'github';

type OAuthOption = {
  provider: SocialProvider;
  label: string;
};

const OAUTH_OPTIONS: OAuthOption[] = [
  { provider: 'google', label: 'Continuar con Google' },
  { provider: 'github', label: 'Continuar con GitHub' },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Ocurrio un error inesperado.';
}

function ProviderIcon({ provider }: { provider: SocialProvider }) {
  if (provider === 'google') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="oauth-icon">
        <path
          fill="#EA4335"
          d="M12 10.2v3.9h5.4c-.24 1.26-.96 2.34-2.04 3.06l3.3 2.58c1.92-1.77 3.03-4.38 3.03-7.47 0-.72-.06-1.41-.21-2.07H12z"
        />
        <path
          fill="#34A853"
          d="M12 22c2.7 0 4.95-.9 6.6-2.46l-3.3-2.58c-.9.6-2.04.96-3.3.96-2.58 0-4.8-1.74-5.58-4.08l-3.42 2.64C4.62 19.68 8.04 22 12 22z"
        />
        <path
          fill="#FBBC05"
          d="M6.42 13.86A6.58 6.58 0 0 1 6.12 12c0-.66.12-1.32.3-1.86L3 7.5A10.53 10.53 0 0 0 2 12c0 1.62.39 3.18 1 4.5l3.42-2.64z"
        />
        <path
          fill="#4285F4"
          d="M12 6.12c1.44 0 2.7.48 3.72 1.44l2.82-2.82C16.95 3.3 14.7 2.4 12 2.4c-3.96 0-7.38 2.31-9 5.7l3.42 2.64C7.2 7.86 9.42 6.12 12 6.12z"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="oauth-icon">
      <path
        fill="#111827"
        d="M12 .5a11.5 11.5 0 0 0-3.63 22.42c.57.1.78-.25.78-.56v-2.15c-3.18.69-3.85-1.35-3.85-1.35-.52-1.33-1.28-1.69-1.28-1.69-1.04-.72.08-.71.08-.71 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.24 3.34.95.1-.74.4-1.24.72-1.52-2.54-.29-5.21-1.27-5.21-5.64 0-1.25.44-2.26 1.18-3.06-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.17a10.9 10.9 0 0 1 5.77 0c2.2-1.48 3.17-1.17 3.17-1.17.62 1.59.23 2.76.11 3.05.74.8 1.18 1.81 1.18 3.06 0 4.38-2.68 5.35-5.23 5.63.41.35.77 1.03.77 2.08v3.08c0 .31.21.67.79.56A11.5 11.5 0 0 0 12 .5z"
      />
    </svg>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingProvider, setPendingProvider] = useState<SocialProvider | null>(
    null,
  );
  const [pendingSignOut, setPendingSignOut] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function initializeSession() {
      try {
        const currentSession = await getSession();
        if (isMounted) {
          setSession(currentSession);
        }
      } catch (error) {
        if (isMounted) {
          setMessage(getErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void initializeSession();

    const unsubscribe = onSessionChange((nextSession) => {
      setSession(nextSession);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  async function handleSignIn(provider: SocialProvider) {
    setMessage('');
    setPendingProvider(provider);

    try {
      await signInWithProvider(provider);
    } catch (error) {
      setMessage(getErrorMessage(error));
      setPendingProvider(null);
    }
  }

  async function handleSignOut() {
    setMessage('');
    setPendingSignOut(true);

    try {
      await signOut();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setPendingSignOut(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-lockup">
          <div className="brand-badge" aria-hidden="true">
            P
          </div>
          <div>
            <h1>Parkit</h1>
            <p className="subtitle">Acceso seguro para tu operacion diaria</p>
          </div>
        </div>

        {loading ? (
          <p className="muted">Cargando sesion...</p>
        ) : session ? (
          <>
            <h2>Welcome</h2>
            <p className="user-pill">{session.user.email ?? session.user.id}</p>
            <button
              className="signout-button"
              onClick={() => {
                void handleSignOut();
              }}
              disabled={pendingSignOut}
            >
              {pendingSignOut ? 'Cerrando...' : 'Cerrar sesion'}
            </button>
          </>
        ) : (
          <>
            <h2>Iniciar sesion</h2>
            <p className="muted">Elegi tu proveedor para continuar.</p>
            <div className="oauth-list">
              {OAUTH_OPTIONS.map((option) => (
                <button
                  key={option.provider}
                  className="oauth-button"
                  onClick={() => {
                    void handleSignIn(option.provider);
                  }}
                  disabled={pendingProvider !== null}
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
          </>
        )}

        {message ? <p className="error-banner">{message}</p> : null}
      </section>
    </main>
  );
}
