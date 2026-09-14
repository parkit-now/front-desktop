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
import { AUTH_STORAGE_KEY, getSupabaseClient } from './client';

export type { AppRole, MeResponseDto } from '../api/auth';

const DEFAULT_OAUTH_REDIRECT_URL = 'parkit://auth/callback';

/**
 * How long the desktop keeps operating on a locally cached session that it
 * could not validate against the server.
 *
 * The first login ALWAYS requires connectivity — there is no offline login. But
 * once an operator has authenticated on this machine, a dead access token is a
 * transport problem, not an authentication one, and it must not stop them from
 * charging a car that is physically at the barrier. The cap exists so a stolen
 * machine (or a deprovisioned operator) cannot keep operating forever.
 */
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const LAST_ONLINE_AUTH_KEY = 'parkit.desktop.lastOnlineAuthAt';

/**
 * Margen con el que un access token se considera ya vencido, alineado con el
 * `EXPIRY_MARGIN_MS` de supabase-js (3 ticks de 30 s).
 */
const ACCESS_TOKEN_MARGIN_MS = 90_000;

/** ¿El access token guardado sirve para hablar con la API ahora mismo? */
function isAccessTokenFresh(session: Session): boolean {
  const expiresAt = session.expires_at;
  if (typeof expiresAt !== 'number') {
    return false;
  }

  return expiresAt * 1000 - Date.now() > ACCESS_TOKEN_MARGIN_MS;
}

/**
 * Stamps "the server vouched for this session just now", restarting the offline
 * grace window. Called on every login and on every successful token refresh.
 */
export function markOnlineAuth(): void {
  try {
    localStorage.setItem(LAST_ONLINE_AUTH_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: the grace window falls back to "unknown", which
    // `restoreSession` treats as a fresh stamp rather than locking the user out.
  }
}

function readLastOnlineAuthAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ONLINE_AUTH_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Verdict on a cached session that could not be validated against the server.
 *
 * - `usable`: still inside the grace window, keep the operator working.
 * - `expired`: went unvalidated too long, force a real login.
 * - `unstamped`: no stamp at all — a session persisted by a build that predates
 *   the grace window, or storage that lost the key. Treated as usable on
 *   purpose: evicting an operator who did nothing wrong is the worse failure.
 */
export type CachedSessionVerdict = 'usable' | 'expired' | 'unstamped';

/**
 * The offline-session policy, kept pure so it can be tested without a browser.
 */
export function judgeCachedSession(
  lastOnlineAuthAt: number | null,
  now: number = Date.now(),
  graceMs: number = OFFLINE_GRACE_MS,
): CachedSessionVerdict {
  if (lastOnlineAuthAt === null) {
    return 'unstamped';
  }

  return now - lastOnlineAuthAt > graceMs ? 'expired' : 'usable';
}

/** Reads the persisted session without going through supabase-js. */
function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const candidate = parsed as Partial<Session>;
    const usable =
      typeof candidate.access_token === 'string' &&
      typeof candidate.refresh_token === 'string' &&
      typeof candidate.user === 'object' &&
      candidate.user !== null;

    return usable ? (candidate as Session) : null;
  } catch {
    return null;
  }
}

async function clearStoredSession(): Promise<void> {
  try {
    // Local scope only: revoking server-side needs connectivity we may not have.
    await getSupabaseClient().auth.signOut({ scope: 'local' });
  } catch {
    // Fall through to the manual cleanup below.
  }

  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(LAST_ONLINE_AUTH_KEY);
  } catch {
    // Nothing else we can do.
  }
}

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

  const { error } = await getSupabaseClient().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    throw error;
  }
}

async function applyBackendSession(tokens: SessionDto): Promise<Session> {
  const { data, error } = await getSupabaseClient().auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });

  if (error) {
    throw error;
  }

  if (!data.session) {
    throw new Error('No se pudo establecer la sesión local.');
  }

  markOnlineAuth();

  return data.session;
}

export async function getSession(): Promise<Session | null> {
  const {
    data: { session },
  } = await getSupabaseClient().auth.getSession();

  return session;
}

/**
 * Outcome of restoring the session at boot.
 *
 * - `online`: supabase-js handed us a session it considers valid.
 * - `offline`: the server was unreachable, so we fell back to the session
 *   cached on this machine. Still within the grace window.
 * - `grace-expired`: cached session found, but it went unvalidated for longer
 *   than `OFFLINE_GRACE_MS`. Credentials cleared, real login required.
 * - `none`: nothing to restore.
 */
export type RestoreSessionResult =
  | { kind: 'online'; session: Session }
  | { kind: 'offline'; session: Session }
  | { kind: 'grace-expired' }
  | { kind: 'none' };

/**
 * Boot-time session recovery. Use this instead of `getSession()` on startup.
 *
 * Reads storage FIRST and never lets the network gate the boot. Two reasons,
 * and the second one is the expensive lesson:
 *
 * 1. `supabase.auth.getSession()` returns `null` whenever the refresh call
 *    fails — including when it fails purely because there is no network. It
 *    leaves the tokens in storage (it only wipes them on non-retryable
 *    errors), so that `null` is a lie: the operator authenticated on this
 *    machine and the credentials are right there. Believing it drops them at a
 *    login screen they cannot use offline, and the app becomes a brick.
 *
 * 2. It does not even fail FAST. Before giving up it runs the
 *    `_refreshAccessToken` retry loop (exponential backoff, up to ~30s), and
 *    on top of that competes for the navigator lock. Awaiting it offline froze
 *    the splash for 30s+ — unusable when a car is waiting at the barrier.
 *
 * So the access token's own `exp` decides, straight from storage. When it is
 * stale we still enter, and the refresh runs in the background: this kicks one
 * off without awaiting it, and the supabase-js auto-refresh ticker keeps
 * retrying every 30s. Either way `onSessionChange` reports `TOKEN_REFRESHED`
 * once the network is back, which clears the degraded flag.
 */
export async function restoreSession(): Promise<RestoreSessionResult> {
  // El cliente se construye de forma diferida, y construirlo es lo que corre la
  // migración one-shot desde la clave derivada (`migrateDerivedSession` en
  // `./client.ts`). Hay que forzarlo ANTES de leer storage: `readStoredSession`
  // va derecho a localStorage, así que sin esto un equipo ya instalado se
  // deslogea al actualizar.
  getSupabaseClient();

  const cached = readStoredSession();
  if (!cached) {
    return { kind: 'none' };
  }

  const verdict = judgeCachedSession(readLastOnlineAuthAt());

  if (verdict === 'expired') {
    await clearStoredSession();
    return { kind: 'grace-expired' };
  }

  if (verdict === 'unstamped') {
    // Start the clock now so the window is bounded from here on.
    markOnlineAuth();
  }

  if (isAccessTokenFresh(cached)) {
    return { kind: 'online', session: cached };
  }

  // Deliberately not awaited: with connectivity this resolves in well under a
  // second and `onSessionChange` upgrades the session; without it, it would
  // block the boot for half a minute for nothing.
  void getSession().catch(() => null);

  return { kind: 'offline', session: cached };
}

export function onSessionChange(
  callback: (session: Session | null) => void,
): () => void {
  const {
    data: { subscription },
  } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
    // Both events mean the server answered, so the session is validated online
    // and the offline grace window restarts. `INITIAL_SESSION` is excluded on
    // purpose: it can be replayed straight from storage without any round trip.
    if (session && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
      markOnlineAuth();
    }
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

  const { data, error } = await getSupabaseClient().auth.signInWithOAuth({
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

  const { error } = await getSupabaseClient().auth.signOut();

  try {
    localStorage.removeItem(LAST_ONLINE_AUTH_KEY);
  } catch {
    // Best effort: a stale stamp is harmless without a session next to it.
  }

  if (error) {
    throw error;
  }
}
