type AuthLike = { message?: string; code?: string; status?: number } | null | undefined;

const KEY_PROBLEM = 'The app’s Supabase key was rejected. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart "npm run dev".';

/** Turn a Supabase auth error into a message that names the real cause. */
export function authErrorMessage(err: AuthLike): string {
  const msg = err?.message ?? '';
  if (/invalid api key|apikey/i.test(msg) || err?.status === 401) return KEY_PROBLEM;
  if (err?.code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) return 'Email or password is incorrect.';
  if (err?.code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return 'Confirm your email first. Check your inbox for the link.';
  if (err?.code === 'over_request_rate_limit' || err?.code === 'over_email_send_rate_limit' || err?.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (/failed to fetch|network/i.test(msg)) return 'Could not reach Supabase. Check your internet connection and VITE_SUPABASE_URL.';
  return msg || 'Something went wrong. Try again.';
}
