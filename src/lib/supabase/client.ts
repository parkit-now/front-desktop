import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Storage key for the persisted Supabase session.
 *
 * Set explicitly so the offline boot path can read the session straight from
 * localStorage (see `restoreSession` in `./session.ts`). Left to itself,
 * supabase-js derives the key from the URL hostname
 * (`sb-<first-hostname-segment>-auth-token`), which differs per environment
 * (`sb-127-auth-token` in dev vs `sb-<project-ref>-auth-token` in prod) — too
 * fragile to depend on for keeping an operator logged in.
 */
export const AUTH_STORAGE_KEY = 'parkit.auth.session';

/** The key supabase-js would have derived on its own. */
function derivedStorageKey(url: string): string | null {
  try {
    const [firstSegment] = new URL(url).hostname.split('.');
    return firstSegment ? `sb-${firstSegment}-auth-token` : null;
  } catch {
    return null;
  }
}

/**
 * One-shot migration for machines installed before `AUTH_STORAGE_KEY` existed:
 * their session lives under the derived key. Without this they would be logged
 * out on upgrade — and if that upgrade lands while the parking lot has no
 * connectivity, the operator cannot log back in at all.
 */
function migrateDerivedSession(url: string): void {
  try {
    if (localStorage.getItem(AUTH_STORAGE_KEY)) {
      return;
    }

    const legacyKey = derivedStorageKey(url);
    if (!legacyKey || legacyKey === AUTH_STORAGE_KEY) {
      return;
    }

    const legacyValue = localStorage.getItem(legacyKey);
    if (!legacyValue) {
      return;
    }

    localStorage.setItem(AUTH_STORAGE_KEY, legacyValue);
    localStorage.removeItem(legacyKey);
  } catch {
    // Storage unavailable or full: the user just logs in again. Never let this
    // block client creation.
  }
}

let client: SupabaseClient | null = null;

/**
 * The Supabase client, built on first use and memoized from then on.
 *
 * Deliberately NOT a module-level `const`: creating the client (and validating
 * the env vars) while the module is being imported hacía explotar suites de
 * lógica pura que solo llegaban acá arrastradas por la cadena de imports
 * (`session.test.ts`, `useCameraDetections.test.ts`). La validación sigue
 * intacta — se dispara cuando alguien usa el cliente de verdad, no cuando
 * alguien importa cualquier cosa del módulo.
 *
 * Mismo cliente, mismas opciones, mismas env vars que antes: lo único que
 * cambió es *cuándo* se construye.
 *
 * @throws si faltan `VITE_SUPABASE_URL` o `VITE_SUPABASE_ANON_KEY`.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }

  const supabaseUrlRaw: unknown = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKeyRaw: unknown = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (
    typeof supabaseUrlRaw !== 'string' ||
    !supabaseUrlRaw ||
    typeof supabaseAnonKeyRaw !== 'string' ||
    !supabaseAnonKeyRaw
  ) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment',
    );
  }

  migrateDerivedSession(supabaseUrlRaw);

  client = createClient(supabaseUrlRaw, supabaseAnonKeyRaw, {
    auth: { storageKey: AUTH_STORAGE_KEY },
  });

  return client;
}
