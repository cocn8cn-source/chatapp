import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Send } from 'lucide-react';
import { Dialog } from '@/components/Dialog/Dialog';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { fetchConversations, insertMessage, keys, type Message } from './api';
import styles from './ForwardDialog.module.css';

export function ForwardDialog({ open, onClose, message }: { open: boolean; onClose: () => void; message: Message | null }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const convs = useQuery({ queryKey: keys.conversations, queryFn: fetchConversations, enabled: open });
  const [sentTo, setSentTo] = useState<string | null>(null);
  const forward = useMutation({
    mutationFn: async (cid: string) => {
      if (!message) throw new Error('No message selected');
      await insertMessage({ id: crypto.randomUUID(), conversation_id: cid, body: message.body.trim(), forwarded: true });
    },
    onSuccess: async (_, cid) => {
      const name = convs.data?.find((c) => c.id === cid);
      setSentTo(name?.title ?? name?.peer_display_name ?? 'the conversation');
      await qc.invalidateQueries({ queryKey: keys.conversations });
      await qc.invalidateQueries({ queryKey: keys.messages(cid) });
    },
  });
  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (convs.data ?? [])
      .filter((c) => c.id !== message?.conversation_id && !c.archived_at)
      .filter((c) => !f || `${c.title ?? ''} ${c.peer_display_name ?? ''} ${c.peer_username ?? ''}`.toLowerCase().includes(f));
  }, [convs.data, filter, message?.conversation_id]);

  return (
    <Dialog open={open} onClose={onClose} title="Forward message" size="sm"
      description={sentTo ? undefined : 'The text is copied into the selected chat and marked as forwarded.'}>
      {sentTo ? (
        <div className={styles.done}>
          <p role="status">Forwarded to <strong>{sentTo}</strong>.</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className={styles.body}>
          <label className={styles.search}>
            <Search size={16} aria-hidden />
            <span className="sr-only">Search conversations</span>
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search chats" />
          </label>
          {message && <p className={styles.preview}>“{message.body.slice(0, 140)}{message.body.length > 140 ? '…' : ''}”</p>}
          <ul className={styles.list}>
            {convs.isLoading && <li className={styles.note} role="status">Loading chats…</li>}
            {convs.isError && <li className={styles.err} role="alert">Could not load chats.</li>}
            {rows.length === 0 && !convs.isLoading && <li className={styles.note}>No other chats available.</li>}
            {rows.map((c) => {
              const name = c.peer_display_name ?? c.title ?? 'Conversation';
              return (
                <li key={c.id}>
                  <button onClick={() => forward.mutate(c.id)} disabled={forward.isPending}>
                    <Avatar name={name} path={c.kind === 'group' ? c.photo_path : c.peer_avatar_path} bucket={c.kind === 'group' ? 'group-photos' : 'avatars'} size={38} />
                    <span className={styles.name}>{name}<small>{c.kind === 'group' ? `${c.member_count} members` : `@${c.peer_username ?? ''}`}</small></span>
                    <Send size={16} aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          {forward.isError && <p className={styles.err} role="alert">{(forward.error as Error).message}</p>}
        </div>
      )}
    </Dialog>
  );
}
