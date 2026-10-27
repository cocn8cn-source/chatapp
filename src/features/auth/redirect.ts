/**
 * Where to send someone after they sign in. Only in-app paths are accepted so a crafted
 * `state.from` / notification URL can never become an open redirect.
 */
export const DEFAULT_APP_PATH = '/app/chats';

export function safeAppPath(value: unknown, fallback: string = DEFAULT_APP_PATH): string {
  if (typeof value !== 'string') return fallback;
  if (value !== '/app' && !value.startsWith('/app/')) return fallback;
  if (value === '/app' || value === '/app/') return fallback;
  if (value.startsWith('//') || value.includes('://') || value.includes('\\')) return fallback;
  return value;
}

/** Reads the `from` location that RequireAuth stores when it bounces a signed-out visitor. */
export function fromState(state: unknown): string {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  return safeAppPath(from);
}
