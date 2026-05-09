import { useState } from 'react';
import { hasSupabaseEnv } from './lib/supabase/env';
import { getAccessToken } from './lib/supabase/session';

export function App() {
  const [token, setToken] = useState('');

  const envReady = hasSupabaseEnv(import.meta.env);

  async function handleReadSession() {
    const value = await getAccessToken();
    setToken(value ?? 'No hay sesión activa');
  }

  return (
    <main className="desktop-shell">
      <article className="desktop-card">
        <h1>front-desktop</h1>
        <p>Preset: desktop</p>
        <p>Supabase env: {envReady ? 'ok' : 'missing'}</p>
        <button
          onClick={() => {
            void handleReadSession();
          }}
        >
          Leer access token
        </button>
        <pre>{token}</pre>
      </article>
    </main>
  );
}
