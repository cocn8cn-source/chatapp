import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

let mountSeq = 0;

/**
 * A channel instance that is safe to create inside a React effect.
 *
 * Supabase dedupes channels by topic: calling `channel('thread:123')` while an
 * earlier instance with that topic is still registered returns the *old*
 * channel. React StrictMode mounts effects twice in development (and fast
 * navigation can overlap), so the second subscription would be attached to an
 * already-subscribed/leaving channel and silently never join — no messages,
 * reactions, typing or calls arrive until a manual refetch.
 *
 * A per-subscription suffix makes every mount independent. Callers still
 * `removeChannel()` in cleanup.
 */
export function createChannel(topic: string): RealtimeChannel | null {
  if (!supabase) return null;
  mountSeq += 1;
  return supabase.channel(`${topic}.${mountSeq}-${Math.random().toString(36).slice(2, 8)}`);
}
