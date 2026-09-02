import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { CameraAlert } from './features/camera/CameraAlert';
import { ForgotPasswordScreen } from './features/auth/ForgotPasswordScreen';
import { LoginScreen } from './features/auth/LoginScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';
import { SessionView } from './features/auth/SessionView';
import { getErrorMessage } from './features/auth/errors';
import { useToast } from './lib/notifications/ToastProvider';
import {
  getSession,
  hydrateSessionFromUrl,
  onSessionChange,
} from './lib/supabase/session';

type View = 'login' | 'register' | 'forgot';

export function App() {
  const { showToast } = useToast();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('login');

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
      if (!nextSession && !navigator.onLine) {
        // Keep the cached session while offline; refresh retries on reconnect.
        return;
      }
      setSession(nextSession);
      if (!nextSession) {
        setView('login');
      }
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
    return (
      <>
        <CameraAlert />
        <SessionView session={session} />
      </>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-lockup">
          <div className="brand-badge" aria-hidden="true">
            P
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
          />
        )}
      </section>
    </main>
  );
}
