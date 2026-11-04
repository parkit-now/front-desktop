// @vitest-environment happy-dom
import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCurrentUser,
  getRoleFromSession,
  hydrateSessionFromUrl,
  onSessionChange,
  refreshCurrentSession,
  registerWithEmail,
  restoreSession,
  signInWithEmail,
  signInWithProvider,
  signOut,
} from './session';

const auth = vi.hoisted(() => ({
  setSession: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
}));
const api = vi.hoisted(() => ({
  fetchMe: vi.fn(),
  logoutBackend: vi.fn(),
  loginWithPassword: vi.fn(),
  refreshSessionTokens: vi.fn(),
  registerWithPassword: vi.fn(),
}));

vi.mock('./client', () => ({
  AUTH_STORAGE_KEY: 'parkit.test.auth',
  getSupabaseClient: () => ({ auth }),
}));
vi.mock('../api/auth', () => api);

const STAMP_KEY = 'parkit.desktop.lastOnlineAuthAt';
const DAY = 24 * 60 * 60 * 1000;

function session(overrides: Partial<Session> = {}): Session {
  return {
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'user-1', app_metadata: {} },
    ...overrides,
  } as Session;
}

function store(value: Session) {
  localStorage.setItem('parkit.test.auth', JSON.stringify(value));
}

const TOKENS = { accessToken: 'access', refreshToken: 'refresh' };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  auth.setSession.mockResolvedValue({
    data: { session: session() },
    error: null,
  });
  auth.getSession.mockResolvedValue({ data: { session: session() } });
  auth.signOut.mockResolvedValue({ error: null });
});

describe('restoreSession (arranque en frío)', () => {
  it('sin sesión guardada no hay nada que restaurar', async () => {
    expect(await restoreSession()).toEqual({ kind: 'none' });

    localStorage.setItem('parkit.test.auth', '{"access_token":1}');
    expect(await restoreSession()).toEqual({ kind: 'none' });
  });

  it('con el token vigente entra online', async () => {
    store(session());
    localStorage.setItem(STAMP_KEY, String(Date.now()));

    const result = await restoreSession();

    expect(result.kind).toBe('online');
  });

  it('con el token vencido entra offline dentro de la ventana de gracia', async () => {
    store(session({ expires_at: Math.floor(Date.now() / 1000) - 60 }));
    localStorage.setItem(STAMP_KEY, String(Date.now() - DAY));

    const result = await restoreSession();

    expect(result.kind).toBe('offline');
  });

  it('pasada la ventana de gracia limpia las credenciales', async () => {
    store(session());
    localStorage.setItem(STAMP_KEY, String(Date.now() - 8 * DAY));

    expect(await restoreSession()).toEqual({ kind: 'grace-expired' });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(localStorage.getItem('parkit.test.auth')).toBeNull();
  });

  it('una sesión sin sello arranca el reloj', async () => {
    store(session());

    await restoreSession();

    expect(localStorage.getItem(STAMP_KEY)).not.toBeNull();
  });
});

describe('inicio y cierre de sesión', () => {
  it('hidrata la sesión desde el deep link de OAuth', async () => {
    await hydrateSessionFromUrl(null);
    await hydrateSessionFromUrl('parkit://auth/callback?x=1');
    expect(auth.setSession).not.toHaveBeenCalled();

    await hydrateSessionFromUrl(
      'parkit://auth/callback#access_token=a%2Bb&refresh_token=r&&=x',
    );
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: 'a+b',
      refresh_token: 'r',
    });

    await expect(
      hydrateSessionFromUrl('parkit://cb?error_description=Denegado+por+vos'),
    ).rejects.toThrow('Denegado por vos');

    auth.setSession.mockResolvedValueOnce({ error: new Error('jwt') });
    await expect(
      hydrateSessionFromUrl('parkit://cb#access_token=a&refresh_token=r'),
    ).rejects.toThrow('jwt');
  });

  it('login y registro guardan los tokens y sellan el login online', async () => {
    api.loginWithPassword.mockResolvedValue(TOKENS);
    api.registerWithPassword.mockResolvedValue({ session: TOKENS });

    await signInWithEmail('ana@parkit.test', 'secreto');
    await registerWithEmail(' Ana ', 'ana@parkit.test', 'secreto123');

    expect(api.registerWithPassword).toHaveBeenCalledWith({
      name: 'Ana',
      email: 'ana@parkit.test',
      password: 'secreto123',
    });
    expect(localStorage.getItem(STAMP_KEY)).not.toBeNull();

    auth.setSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    await expect(signInWithEmail('a@b.c', 'x')).rejects.toThrow(
      'No se pudo establecer la sesión local.',
    );
  });

  it('OAuth sólo funciona en la app de escritorio', async () => {
    await expect(signInWithProvider('google')).rejects.toThrow(
      'El login social solo está disponible en la app de escritorio.',
    );

    const openExternal = vi.fn(() => Promise.resolve());
    window.parkitDesktop = { openExternal } as never;
    auth.signInWithOAuth.mockResolvedValue({
      data: { url: 'https://supabase.test/authorize' },
      error: null,
    });
    await signInWithProvider('google');
    expect(openExternal).toHaveBeenCalledWith(
      'https://supabase.test/authorize',
    );

    auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null });
    await expect(signInWithProvider('github')).rejects.toThrow(
      'Supabase no devolvió una URL de OAuth.',
    );

    auth.signInWithOAuth.mockResolvedValue({
      data: null,
      error: new Error('oauth'),
    });
    await expect(signInWithProvider('github')).rejects.toThrow('oauth');
    delete window.parkitDesktop;
  });

  it('onSessionChange sella los logins y se desuscribe', () => {
    const unsubscribe = vi.fn();
    auth.onAuthStateChange.mockImplementation(
      (handler: (event: string, value: Session | null) => void) => {
        handler('TOKEN_REFRESHED', session());
        return { data: { subscription: { unsubscribe } } };
      },
    );
    const callback = vi.fn();

    onSessionChange(callback)();

    expect(callback).toHaveBeenCalled();
    expect(localStorage.getItem(STAMP_KEY)).not.toBeNull();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('lee el rol de la metadata del usuario', () => {
    expect(getRoleFromSession(null)).toBeNull();
    expect(
      getRoleFromSession(
        session({ user: { app_metadata: { role: 'admin' } } as never }),
      ),
    ).toBe('admin');
    expect(
      getRoleFromSession(
        session({ user: { app_metadata: { role: 'otro' } } as never }),
      ),
    ).toBeNull();
  });

  it('getCurrentUser y refreshCurrentSession usan la sesión actual', async () => {
    api.fetchMe.mockResolvedValue({ id: 'user-1' });
    api.refreshSessionTokens.mockResolvedValue(TOKENS);

    expect(await getCurrentUser()).toEqual({ id: 'user-1' });
    await refreshCurrentSession();
    expect(api.refreshSessionTokens).toHaveBeenCalledWith({
      refreshToken: 'refresh',
    });

    auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await getCurrentUser()).toBeNull();
    expect(await refreshCurrentSession()).toBeNull();
  });

  it('signOut limpia aunque falle el backend y propaga el error local', async () => {
    localStorage.setItem(STAMP_KEY, '1');
    api.logoutBackend.mockRejectedValue(new Error('offline'));

    await signOut();
    expect(localStorage.getItem(STAMP_KEY)).toBeNull();

    auth.signOut.mockResolvedValue({ error: new Error('storage') });
    await expect(signOut()).rejects.toThrow('storage');
  });
});
