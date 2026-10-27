import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { envResult } from '@/config/env';

/** null when Supabase env vars are missing; the UI shows a setup notice instead of crashing. */
export const supabase: SupabaseClient | null = envResult.ok
  ? createClient(envResult.env.VITE_SUPABASE_URL, envResult.env.VITE_SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

if (import.meta.env.DEV && envResult.ok) {
  // Dev-only diagnostic: identify the project without printing any part of the key.
  console.info(`[ChatSpace] Supabase host=${new URL(envResult.env.VITE_SUPABASE_URL).host} (publishable key loaded)`);
}
