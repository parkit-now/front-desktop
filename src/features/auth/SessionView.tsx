import type { Session } from '@supabase/supabase-js';
import { useState } from 'react';
import { useToast } from '../../lib/notifications/ToastProvider';
import { signOut } from '../../lib/supabase/session';
import { getErrorMessage } from './errors';

type Props = {
  session: Session;
};

export function SessionView({ session }: Props) {
  const { showToast } = useToast();
  const [pendingSignOut, setPendingSignOut] = useState(false);

  async function handleSignOut() {
    setPendingSignOut(true);
    try {
      await signOut();
    } catch (error) {
      showToast({ message: getErrorMessage(error), kind: 'error' });
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
        {pendingSignOut ? 'Cerrando...' : 'Cerrar sesión'}
      </button>
    </>
  );
}
