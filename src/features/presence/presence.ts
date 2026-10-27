export type PresenceEntry = {
  online: boolean;
  updated_at: string;
  last_seen_at: string | null;
};

export const ONLINE_TTL_MS = 90_000;

/** A stale heartbeat must not leave someone shown as online forever. */
export function isOnline(entry: PresenceEntry | undefined, now = Date.now()): boolean {
  if (!entry || !entry.online) return false;
  const seen = new Date(entry.updated_at).getTime();
  return Number.isFinite(seen) && now - seen < ONLINE_TTL_MS;
}

export function lastSeenLabel(entry: PresenceEntry | undefined, now = Date.now()): string | null {
  if (!entry?.last_seen_at) return null;
  const then = new Date(entry.last_seen_at).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Last seen yesterday';
  if (days < 7) return `Last seen ${days} days ago`;
  return `Last seen ${new Date(then).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}

export function presenceLabel(entry: PresenceEntry | undefined, now = Date.now()): string {
  if (isOnline(entry, now)) return 'Online';
  return lastSeenLabel(entry, now) ?? 'Offline';
}
