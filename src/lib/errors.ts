type PostgrestLike = { code?: string; message?: string };

/**
 * PostgREST reports a missing function or table through PGRST202/PGRST205.
 * That almost always means the Supabase migrations have not been applied
 * (or only partially applied), so the UI can point the owner at the fix
 * instead of showing a dead-end "could not load" message.
 */
export function isMissingSchemaObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as PostgrestLike;
  if (e.code === 'PGRST202' || e.code === 'PGRST205') return true;
  return /could not find the (function|table)|in the schema cache/i.test(e.message ?? '');
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  const message = (error as PostgrestLike | null)?.message;
  return message || fallback;
}
