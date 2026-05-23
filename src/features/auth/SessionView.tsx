import type { Session } from '@supabase/supabase-js';
import { useState } from 'react';
import { signOut } from '../../lib/supabase/session';
import { getErrorMessage } from './errors';

type Props = {
  session: Session;
};

export function SessionView({ session }: Props) {
  const [pendingSignOut, setPendingSignOut] = useState(false);
  const [message, setMessage] = useState('');

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
      {message ? <p className="error-banner">{message}</p> : null}
    </>
  );
}
