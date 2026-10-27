import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import { activeTypers, TYPING_TTL_MS, type TypingRow } from './typing';

export function useTyping(cid: string, uid: string) {
  const [rows, setRows] = useState<Record<string, TypingRow>>({});
  const lastSent = useRef(0);
  const stopTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    const fresh = new Date(Date.now() - TYPING_TTL_MS).toISOString();
    void supabase.from('typing_indicators').select('user_id, updated_at').eq('conversation_id', cid)
      .gt('updated_at', fresh).then(({ data }) => {
        if (cancelled || !data) return;
        setRows(Object.fromEntries(data.map((r) => [r.user_id, r as TypingRow])));
      });

    const apply = (r: TypingRow | undefined) => {
      if (!r || r.user_id === uid) return;
      setRows((cur) => ({ ...cur, [r.user_id]: r }));
    };
    const channel = createChannel(`typing:${cid}`);
    if (!channel) return;
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'typing_indicators', filter: `conversation_id=eq.${cid}` },
        (p) => apply(p.new as TypingRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'typing_indicators', filter: `conversation_id=eq.${cid}` },
        (p) => apply(p.new as TypingRow))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'typing_indicators', filter: `conversation_id=eq.${cid}` },
        (p) => {
          const old = p.old as Partial<TypingRow>;
          if (old.user_id) setRows((cur) => { const next = { ...cur }; delete next[old.user_id!]; return next; });
        })
      .subscribe();

    const prune = window.setInterval(() => {
      setRows((cur) => {
        const now = Date.now();
        const next: Record<string, TypingRow> = {};
        let changed = false;
        for (const [id, r] of Object.entries(cur)) {
          if (now - new Date(r.updated_at).getTime() < TYPING_TTL_MS) next[id] = r;
          else changed = true;
        }
        return changed ? next : cur;
      });
    }, 1_500);

    return () => {
      cancelled = true;
      window.clearInterval(prune);
      void supabase!.removeChannel(channel);
      setRows({});
    };
  }, [cid, uid]);

  const notifyTyping = useCallback(() => {
    if (!supabase) return;
    const now = Date.now();
    if (now - lastSent.current < 2_500) return;
    lastSent.current = now;
    void supabase.from('typing_indicators').upsert(
      { conversation_id: cid, user_id: uid, updated_at: new Date().toISOString() },
      { onConflict: 'conversation_id,user_id' },
    ).then(() => {});
    window.clearTimeout(stopTimer.current);
    stopTimer.current = window.setTimeout(() => {
      void supabase?.from('typing_indicators').delete().eq('conversation_id', cid).eq('user_id', uid);
    }, TYPING_TTL_MS);
  }, [cid, uid]);

  const stopTyping = useCallback(() => {
    lastSent.current = 0;
    window.clearTimeout(stopTimer.current);
    void supabase?.from('typing_indicators').delete().eq('conversation_id', cid).eq('user_id', uid);
  }, [cid, uid]);

  useEffect(() => () => {
    window.clearTimeout(stopTimer.current);
    void supabase?.from('typing_indicators').delete().eq('conversation_id', cid).eq('user_id', uid);
  }, [cid, uid]);

  return { typingUserIds: activeTypers(Object.values(rows), uid), notifyTyping, stopTyping };
}
