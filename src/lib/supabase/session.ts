import { type Provider, type Session } from '@supabase/supabase-js';
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

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}
