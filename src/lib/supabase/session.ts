import { type Provider, type Session } from '@supabase/supabase-js';
import {
  fetchMe,
  logoutBackend,
  loginWithPassword,
  refreshSessionTokens,
  registerWithPassword,
  type AppRole,
  type MeResponseDto,
  type SessionDto,
} from '../api/auth';
import { supabase } from './client';

export type { AppRole, MeResponseDto } from '../api/auth';

const DEFAULT_OAUTH_REDIRECT_URL = 'parkit://auth/callback';

function getOAuthRedirectUrl(): string {
  const raw: unknown = import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT_URL;
  return typeof raw === 'string' && raw.length > 0
    ? raw
    : DEFAULT_OAUTH_REDIRECT_URL;
}

function parseUrlParams(url: string): Record<string, string> {
  const hashStart = url.indexOf('#');
  const queryStart = url.indexOf('?');

  const rawParams =
    hashStart >= 0
      ? url.slice(hashStart + 1)
      : queryStart >= 0
        ? url.slice(queryStart + 1)
        : '';

  if (!rawParams) {
    return {};
  }

  return rawParams.split('&').reduce<Record<string, string>>((acc, pair) => {
    if (!pair) {
      return acc;
    }

    const [rawKey, rawValue = ''] = pair.split('=');
    if (!rawKey) {
      return acc;
    }

    acc[decodeURIComponent(rawKey)] = decodeURIComponent(
      rawValue.replace(/\+/g, '%20'),
    );

    return acc;
  }, {});
}

/**
 * Applies the OAuth tokens carried back by the `parkit://auth/callback` deep
 * link (see `electron/main.ts`). Wired to `window.parkitDesktop.onOAuthCallback`
 * in `App.tsx`.
 */
export async function hydrateSessionFromUrl(
  url?: string | null,
): Promise<void> {
  if (!url) {
    return;
  }

  const params = parseUrlParams(url);

  if (params.error_description) {
    throw new Error(params.error_description);
  }

  const accessToken = params.access_token;
  const refreshToken = params.refresh_token;

  if (!accessToken || !refreshToken) {
    return;
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    throw error;
  }
}

async function applyBackendSession(tokens: SessionDto): Promise<Session> {
  const { data, error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  if (error) {
    throw error;
  }

  if (!data.session) {
    throw new Error('No se pudo establecer la sesión local.');
  }

  return data.session;
}

export async function getSession(): Promise<Session | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session;
}

export function onSessionChange(
  callback: (session: Session | null) => void,
): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => {
    subscription.unsubscribe();
  };
}

export async function signInWithProvider(provider: Provider): Promise<void> {
  const bridge =
    typeof window !== 'undefined' ? window.parkitDesktop : undefined;

  if (!bridge?.openExternal) {
    throw new Error(
      'El login social solo está disponible en la app de escritorio.',
    );
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getOAuthRedirectUrl(),
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw error;
  }

  if (!data?.url) {
    throw new Error('Supabase no devolvió una URL de OAuth.');
  }

  // Open the provider consent screen in the user's real browser. The session
  // is applied later, when Supabase redirects to `parkit://auth/callback` and
  // `onOAuthCallback` (App.tsx) forwards the tokens to `hydrateSessionFromUrl`.
  await bridge.openExternal(data.url);
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<Session> {
  const tokens = await loginWithPassword({ email, password });
  return applyBackendSession(tokens);
}

export async function registerWithEmail(
  email: string,
  password: string,
): Promise<Session> {
  // The backend always provisions a global `user`; no `role` is sent.
  const result = await registerWithPassword({ email, password });
  return applyBackendSession(result.session);
}

/**
 * Reads the GLOBAL platform role (`admin | user`) from the JWT
 * (`app_metadata.role`). The owner/operator role is NOT here — it lives in the
 * entity memberships, resolved via `getCurrentUser` (`GET /auth/me`).
 */
export function getRoleFromSession(session: Session | null): AppRole | null {
  const role: unknown = session?.user.app_metadata.role;
  return role === 'admin' || role === 'user' ? role : null;
}

/**
 * Fetches the caller's identity, global role and entity memberships.
 *
 * Desktop is for owners/operators: after login the global `user` operates over
 * the entities returned in `memberships` (each with its `owner | operator`
 * role). Use this where the post-login flow needs to know the entities.
 */
export async function getCurrentUser(): Promise<MeResponseDto | null> {
  const current = await getSession();
  const accessToken = current?.access_token;
  if (!accessToken) {
    return null;
  }
  return fetchMe(accessToken);
}

export async function refreshCurrentSession(): Promise<Session | null> {
  const current = await getSession();
  if (!current?.refresh_token) {
    return null;
  }
  const tokens = await refreshSessionTokens({
    refreshToken: current.refresh_token,
  });
  return applyBackendSession(tokens);
}

export async function signOut(): Promise<void> {
  const current = await getSession();
  const accessToken = current?.access_token;

  if (accessToken) {
    try {
      await logoutBackend(accessToken);
    } catch {
      // Backend revoke falló: igual limpiamos sesión local para no dejar al usuario atrapado.
    }
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}
