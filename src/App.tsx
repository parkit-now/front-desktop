import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ForgotPasswordScreen } from './features/auth/ForgotPasswordScreen';
import { LoginScreen } from './features/auth/LoginScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';
import { SessionView } from './features/auth/SessionView';
import { getErrorMessage } from './features/auth/errors';
import { useToast } from './lib/notifications/ToastProvider';
import {
  hydrateSessionFromUrl,
  onSessionChange,
  restoreSession,
} from './lib/supabase/session';
import { PARKIT_LOGO_URL } from './lib/brand';

type View = 'login' | 'register' | 'forgot';

const GRACE_EXPIRED_NOTICE =
  'Pasó demasiado tiempo sin conexión con el servidor. Iniciá sesión para volver a operar y sincronizar los cambios guardados en este equipo.';

export function App() {
  const { showToast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('login');
  // Session came from local storage and the server has not confirmed it yet.
  const [sessionStale, setSessionStale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initializeSession() {
      try {
        // NOT `getSession()`: that returns null whenever the refresh call fails,
        // network outages included, even though the tokens are still on disk.
        // Trusting it strands the operator on a login screen they cannot use
        // without connectivity. See `restoreSession`.
        const result = await restoreSession();
        if (!isMounted) {
          return;
        }

        if (result.kind === 'online' || result.kind === 'offline') {
          setSession(result.session);
          setSessionStale(result.kind === 'offline');
        } else {
          setSession(null);
          setSessionStale(false);
          if (result.kind === 'grace-expired') {
            setNotice(GRACE_EXPIRED_NOTICE);
          }
        }
      } catch (error) {
        if (isMounted) {
          showToast({ message: getErrorMessage(error), kind: 'error' });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void initializeSession();

    const unsubscribe = onSessionChange((nextSession) => {
      if (nextSession) {
        // The server answered, so the session is no longer running on trust.
        setSession(nextSession);
        setSessionStale(false);
        setNotice(null);
        return;
      }

      if (!navigator.onLine) {
        // Keep the cached session while offline; refresh retries on reconnect.
        return;
      }

      setSession(null);
      setSessionStale(false);
      setView('login');
    });

    // Social login: the browser redirects to `parkit://auth/callback` and main
    // forwards the tokens here so we can apply the session.
    const unsubscribeOAuth = window.parkitDesktop?.onOAuthCallback((url) => {
      void hydrateSessionFromUrl(url).catch((error) => {
        if (isMounted) {
          showToast({ message: getErrorMessage(error), kind: 'error' });
        }
      });
    });

    return () => {
      isMounted = false;
      unsubscribe();
      unsubscribeOAuth?.();
    };
  }, [showToast]);

  if (session) {
    return <SessionView session={session} sessionStale={sessionStale} />;
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-lockup">
          <div className="brand-badge" aria-hidden="true">
            <img src={PARKIT_LOGO_URL} alt="" />
          </div>
          <h1>Parkit</h1>
        </div>

        {loading ? (
          <p className="muted">Cargando sesión...</p>
        ) : view === 'register' ? (
          <RegisterScreen
            onSwitchToLogin={() => {
              setView('login');
            }}
          />
        ) : view === 'forgot' ? (
          <ForgotPasswordScreen
            onBackToLogin={() => {
              setView('login');
            }}
          />
        ) : (
          <LoginScreen
            onSwitchToRegister={() => {
              setView('register');
            }}
            onForgotPassword={() => {
              setView('forgot');
            }}
            notice={notice}
          />
        )}
      </section>
    </main>
  );
}
