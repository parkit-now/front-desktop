import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { LoginScreen } from './features/auth/LoginScreen';
import { RegisterScreen } from './features/auth/RegisterScreen';
import { SessionView } from './features/auth/SessionView';
import { getErrorMessage } from './features/auth/errors';
import { getSession, onSessionChange } from './lib/supabase/session';

type View = 'login' | 'register';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('login');
  const [bootError, setBootError] = useState('');

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
          setBootError(getErrorMessage(error));
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
  }, []);

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
          <SessionView session={session} />
        ) : view === 'register' ? (
          <RegisterScreen
            onSwitchToLogin={() => {
              setView('login');
            }}
          />
        ) : (
          <LoginScreen
            onSwitchToRegister={() => {
              setView('register');
            }}
          />
        )}

        {bootError ? <p className="error-banner">{bootError}</p> : null}
      </section>
    </main>
  );
}
