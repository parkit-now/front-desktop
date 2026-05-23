import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ForgotPasswordScreen } from './features/auth/ForgotPasswordScreen';
import { LoginScreen } from './features/auth/LoginScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';
import { SessionView } from './features/auth/SessionView';
import { getErrorMessage } from './features/auth/errors';
import { useToast } from './lib/notifications/ToastProvider';
import { getSession, onSessionChange } from './lib/supabase/session';

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
      setSession(nextSession);
      if (!nextSession) {
        setView('login');
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [showToast]);

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
        ) : session ? (
          <SessionView session={session} />
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
