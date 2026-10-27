import { supabase } from '@/lib/supabase';
import type { PresenceEntry } from './presence';

export async function heartbeatPresence(): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('presence_heartbeat');
}

export async function markPresenceOffline(): Promise<void> {
  if (!supabase) return;
  await supabase.rpc('presence_offline');
}

/** Rows hidden by the other user's privacy settings simply are not returned by RLS. */
export async function fetchVisiblePresence(): Promise<Record<string, PresenceEntry>> {
  if (!supabase) return {};
  const [online, seen] = await Promise.all([
    supabase.from('user_online').select('user_id, online, updated_at').limit(1000),
    supabase.from('user_last_seen').select('user_id, last_seen_at').limit(1000),
  ]);
  if (online.error) throw online.error;
  if (seen.error) throw seen.error;
  const out: Record<string, PresenceEntry> = {};
  for (const row of online.data ?? []) {
    out[row.user_id] = { online: !!row.online, updated_at: row.updated_at, last_seen_at: null };
  }
  for (const row of seen.data ?? []) {
    out[row.user_id] = {
      online: out[row.user_id]?.online ?? false,
      updated_at: out[row.user_id]?.updated_at ?? new Date().toISOString(),
      last_seen_at: row.last_seen_at,
    };
  }
  return out;
}
