import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import { useAuth } from '@/stores/auth';
import { fetchVisiblePresence, heartbeatPresence, markPresenceOffline } from './presenceApi';
import { usePresenceStore } from './presenceStore';

const HEARTBEAT_MS = 45_000;
const REFRESH_MS = 120_000;

/** Mount once for the signed-in app. Never renders anything. */
export function PresenceProvider() {
  const uid = useAuth((s) => s.session?.user.id);

  useEffect(() => {
    if (!supabase || !uid) return;
    let cancelled = false;
    const store = usePresenceStore.getState();

    const load = () => {
      void fetchVisiblePresence()
        .then((rows) => { if (!cancelled) store.replaceAll(rows); })
        .catch(() => { /* transient; the realtime channel will fill in */ });
    };
    const beat = () => {
      if (document.visibilityState === 'hidden') return;
      void heartbeatPresence().catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void markPresenceOffline().catch(() => {});
      else { beat(); load(); }
    };
    const onOnline = () => { beat(); load(); };

    store.clear();
    load();
    beat();
    const heartbeat = window.setInterval(beat, HEARTBEAT_MS);
    const refresh = window.setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    const channel = createChannel(`presence:${uid}`);
    if (!channel) return;
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_online' }, (p) => {
        const row = (p.new ?? {}) as { user_id?: string; online?: boolean; updated_at?: string };
        if (row.user_id && typeof row.online === 'boolean' && row.updated_at) {
          usePresenceStore.getState().setOnline(row.user_id, row.online, row.updated_at);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_last_seen' }, (p) => {
        const row = (p.new ?? {}) as { user_id?: string; last_seen_at?: string };
        if (row.user_id && row.last_seen_at) usePresenceStore.getState().setLastSeen(row.user_id, row.last_seen_at);
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') load(); });

    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      window.clearInterval(refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      void markPresenceOffline().catch(() => {});
      void supabase!.removeChannel(channel);
      usePresenceStore.getState().clear();
    };
  }, [uid]);

  return null;
}
