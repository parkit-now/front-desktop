import { createClient } from '@supabase/supabase-js';

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

export const supabase = createClient(supabaseUrlRaw, supabaseAnonKeyRaw);
