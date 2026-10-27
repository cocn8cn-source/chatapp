import { useCallback, useEffect } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import {
  deleteMessage, editMessage, fetchMessageById, fetchMessages, hideMessage, insertAttachments, insertMessage, keys,
  markDelivered, markRead, PAGE_SIZE, setPinned, setReaction, setStar,
  type Attachment, type Message, type Reaction, type ReplyPreview,
} from './api';
import { flattenOldestFirst, patchMessage, removeMessage, upsertMessage, type MessagePages } from './messageCache';

export function useThread(cid: string, uid: string) {
  const qc = useQueryClient();
  const q = useInfiniteQuery<Message[], Error, MessagePages, readonly unknown[], string | undefined>({
    queryKey: keys.messages(cid),
    initialPageParam: undefined,
    queryFn: ({ pageParam }) => fetchMessages(cid, pageParam),
    getNextPageParam: (last) => (last.length < PAGE_SIZE ? undefined : last[last.length - 1]?.created_at),
  });
  const refreshList = () => void qc.invalidateQueries({ queryKey: keys.conversations });
  const patch = (m: Message) => qc.setQueryData<MessagePages>(keys.messages(cid), (d) => upsertMessage(d, m));
  const patchOne = useCallback((id: string, fn: (m: Message) => Message) =>
    qc.setQueryData<MessagePages>(keys.messages(cid), (d) => patchMessage(d, id, fn)), [qc, cid]);

  // Realtime is filtered by RLS. After every (re)subscribe we resync in case events were missed.
  useEffect(() => {
    if (!supabase) return;
    const patchRow = (msg: Message) =>
      qc.setQueryData<MessagePages>(keys.messages(cid), (d) => upsertMessage(d, msg));
    /** Realtime payloads carry table columns only, so the joined reply and attachments are fetched. */
    const enrich = (id: string) => {
      void fetchMessageById(id).then((full) => { if (full) patchRow(full); }).catch(() => {});
    };
    const onMsg = (payload: { new: unknown; eventType?: string }) => {
      const msg = payload.new as Message;
      patchRow(msg);
      void qc.invalidateQueries({ queryKey: keys.conversations });
      if (payload.eventType === 'INSERT') {
        if (msg.reply_to_id) enrich(msg.id);
        if (msg.sender_id !== uid) void markDelivered(cid).catch(() => {});
      }
    };
    const filter = `conversation_id=eq.${cid}`;
    const channel = createChannel(`thread:${cid}`);
    if (!channel) return;
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, onMsg)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, onMsg)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attachments', filter }, (p) => {
        const row = p.new as { message_id?: string };
        void qc.invalidateQueries({ queryKey: keys.media(cid) });
        // Enrich only the affected message; refetching every loaded page would jump the scroll.
        if (row.message_id) enrich(row.message_id);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, (p) => {
        const row = p.new as Reaction & { message_id: string };
        patchOne(row.message_id, (m) => ({
          ...m,
          message_reactions: [...(m.message_reactions ?? []).filter((r) => !(r.user_id === row.user_id && r.emoji === row.emoji)), { user_id: row.user_id, emoji: row.emoji }],
        }));
        void qc.invalidateQueries({ queryKey: keys.readCounts(cid) });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'message_reactions' }, (p) => {
        const row = p.old as { message_id?: string; user_id?: string; emoji?: string };
        if (!row.message_id) return;
        patchOne(row.message_id, (m) => ({
          ...m,
          message_reactions: (m.message_reactions ?? []).filter((r) => !(r.user_id === row.user_id && r.emoji === row.emoji)),
        }));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pinned_messages', filter }, () => {
        void qc.invalidateQueries({ queryKey: keys.pins(cid) });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_reads', filter }, () => {
        void qc.invalidateQueries({ queryKey: keys.conversations });
        void qc.invalidateQueries({ queryKey: keys.readCounts(cid) });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void qc.invalidateQueries({ queryKey: keys.messages(cid) });
          void markDelivered(cid).catch(() => {});
        }
      });
    return () => { void supabase!.removeChannel(channel); };
  }, [cid, qc, uid, patchOne]);

  const newestId = q.data?.pages[0]?.[0]?.id;
  useEffect(() => {
    const mark = () => {
      if (document.visibilityState !== 'visible') return;
      void markRead(cid).then(() => refreshList()).catch(() => {});
    };
    mark();
    const onVisible = () => { if (document.visibilityState === 'visible') mark(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshList is derived from the stable query client
  }, [cid, newestId, qc]);

  /** Safe to retry with the same id: message and attachment inserts are idempotent. */
  const send = async (
    body: string,
    existingId?: string,
    attachments: Attachment[] = [],
    replyTo: ReplyPreview | null = null,
    forwarded = false,
  ) => {
    const id = existingId ?? crypto.randomUUID();
    const optimistic: Message = {
      id, conversation_id: cid, sender_id: uid, body, created_at: new Date().toISOString(),
      status: 'pending', attachments, reply_to_id: replyTo?.id ?? null, reply_to: replyTo, forwarded,
      message_reactions: [], message_stars: [],
    };
    patch(optimistic);
    try {
      await insertMessage({ id, conversation_id: cid, body, reply_to_id: replyTo?.id ?? null, forwarded });
      await insertAttachments(cid, id, attachments);
      patchOne(id, (m) => ({ ...m, status: undefined }));
      if (attachments.length) void qc.invalidateQueries({ queryKey: keys.media(cid) });
      refreshList();
    } catch {
      patchOne(id, (m) => ({ ...m, status: 'failed' }));
    }
  };

  const edit = async (m: Message, body: string) => {
    await editMessage(m.id, body);
    patchOne(m.id, (x) => ({ ...x, body, edited_at: new Date().toISOString() }));
    refreshList();
  };
  const remove = async (m: Message) => {
    await deleteMessage(m.id);
    patchOne(m.id, (x) => ({ ...x, body: '', deleted_at: new Date().toISOString(), attachments: [] }));
    refreshList();
  };
  const hideForMe = async (m: Message) => {
    await hideMessage(m.id);
    qc.setQueryData<MessagePages>(keys.messages(cid), (d) => removeMessage(d, m.id));
    refreshList();
  };
  const react = async (m: Message, emoji: string, on: boolean) => {
    const current = m.message_reactions ?? [];
    const had = current.some((r) => r.user_id === uid && r.emoji === emoji);
    if (on === had) return;
    const next = on
      ? [...current, { user_id: uid, emoji }]
      : current.filter((r) => !(r.user_id === uid && r.emoji === emoji));
    patchOne(m.id, (x) => ({ ...x, message_reactions: next }));
    try { await setReaction(m.id, emoji, on); }
    catch {
      patchOne(m.id, (x) => ({ ...x, message_reactions: current }));
      throw new Error('Could not update the reaction');
    }
  };
  const pin = async (m: Message, on: boolean) => {
    await setPinned(cid, m.id, on);
    void qc.invalidateQueries({ queryKey: keys.pins(cid) });
  };
  const star = async (m: Message, on: boolean) => {
    await setStar(m.id, on);
    patchOne(m.id, (x) => ({ ...x, message_stars: on ? [{ user_id: uid }] : [] }));
    void qc.invalidateQueries({ queryKey: keys.saved });
  };

  return {
    messages: flattenOldestFirst(q.data), isLoading: q.isLoading, isError: q.isError,
    refetch: q.refetch, hasOlder: q.hasNextPage, loadOlder: () => q.fetchNextPage(), loadingOlder: q.isFetchingNextPage,
    send, edit, remove, hideForMe, react, pin, star,
  };
}
