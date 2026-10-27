import type { CallHistoryItem } from './api';

const key = (uid: string) => `chatspace-calls-seen-${uid}`;
export function markCallsSeen(uid: string) { try { localStorage.setItem(key(uid), new Date().toISOString()); } catch { /* storage unavailable */ } }
export function lastSeen(uid: string): string {
  try { return localStorage.getItem(key(uid)) ?? '1970-01-01T00:00:00Z'; } catch { return '1970-01-01T00:00:00Z'; }
}
/** Incoming calls I never answered, newer than the last time I opened the Calls tab. */
export function countMissed(items: CallHistoryItem[], uid: string, since: string): number {
  return items.filter((c) => c.callee_id === uid && (c.status === 'missed' || c.status === 'cancelled') && c.created_at > since).length;
}
