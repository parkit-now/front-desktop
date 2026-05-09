export function hasSupabaseEnv(env: Record<string, unknown>): boolean {
  return (
    typeof env.VITE_SUPABASE_URL === 'string' &&
    env.VITE_SUPABASE_URL.length > 0 &&
    typeof env.VITE_SUPABASE_ANON_KEY === 'string' &&
    env.VITE_SUPABASE_ANON_KEY.length > 0
  );
}
