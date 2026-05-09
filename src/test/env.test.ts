import { describe, expect, it } from 'vitest';
import { hasSupabaseEnv } from '../lib/supabase/env';

describe('hasSupabaseEnv', () => {
  it('returns true when URL and key exist', () => {
    expect(
      hasSupabaseEnv({
        VITE_SUPABASE_URL: 'http://localhost:54321',
        VITE_SUPABASE_ANON_KEY: 'sb_publishable_123',
      }),
    ).toBe(true);
  });

  it('returns false when key is missing', () => {
    expect(
      hasSupabaseEnv({
        VITE_SUPABASE_URL: 'http://localhost:54321',
      }),
    ).toBe(false);
  });
});
