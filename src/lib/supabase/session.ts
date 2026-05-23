import { type Provider, type Session } from '@supabase/supabase-js';
import {
  logoutBackend,
  loginWithPassword,
  refreshSessionTokens,
  registerWithPassword,
  type SessionDto,
} from '../api/auth';
import { supabase } from './client';

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
    throw new Error('No se pudo establecer la sesion local.');
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
  const result = await registerWithPassword({
    email,
    password,
    role: 'driver',
  });
  return applyBackendSession(result.session);
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
      // Backend revoke fallo: igual limpiamos sesion local para no dejar al usuario atrapado.
    }
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}
