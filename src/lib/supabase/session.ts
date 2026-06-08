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

function resolveRedirectUrl(): string | undefined {
  const customRedirectRaw: unknown = import.meta.env
    .VITE_SUPABASE_OAUTH_REDIRECT_URL;

  const customRedirect =
    typeof customRedirectRaw === 'string' ? customRedirectRaw : undefined;

  if (typeof customRedirect === 'string' && customRedirect.length > 0) {
    return customRedirect;
  }

  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return undefined;
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
  const redirectTo = resolveRedirectUrl();

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: redirectTo ? { redirectTo } : undefined,
  });

  if (error) {
    throw error;
  }
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
