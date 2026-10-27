import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, BellOff, BellRing, Images, MailOpen, Pin, PinOff, Search, Trash2,
} from 'lucide-react';
import { Dialog } from '@/components/Dialog/Dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import {
  clearConversation, deleteConversationForMe, keys, markConversationUnread, updatePrefs,
  type ConversationItem,
} from './api';
import { formatDateTime } from './format';
import { isMuted } from './conversationList';
import styles from './ChatDialogs.module.css';

const MUTES = [
  { label: 'On', ms: 0 },
  { label: '8 hours', ms: 8 * 3600_000 },
  { label: '1 week', ms: 7 * 86400_000 },
  { label: 'Always', ms: null },
] as const;

function until(ms: number | null): string | null {
  if (ms === 0) return null;
  if (ms === null) return '9999-12-31T00:00:00Z';
  return new Date(Date.now() + ms).toISOString();
}

export function ConversationMenu({ conv, uid, onClose, onOpenMedia, onOpenSearch }: {
  conv: ConversationItem; uid: string; onClose: () => void; onOpenMedia?: () => void; onOpenSearch?: () => void;
}) {
  const cid = conv.id;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<'clear' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.conversations });

  const prefs = useMutation({
    mutationFn: (patch: Parameters<typeof updatePrefs>[2]) => updatePrefs(cid, uid, patch),
    onSuccess: refresh, onError: (e) => setError(e.message),
  });
  const unread = useMutation({
    mutationFn: () => markConversationUnread(cid),
    onSuccess: refresh, onError: (e) => setError(e.message),
  });
  const clear = useMutation({
    mutationFn: () => clearConversation(cid),
    onSuccess: async () => {
      setConfirm(null); onClose();
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.messages(cid) }),
        qc.invalidateQueries({ queryKey: keys.conversations }),
        qc.invalidateQueries({ queryKey: keys.media(cid) }),
      ]);
    },
    onError: (e) => { setConfirm(null); setError(e.message); },
  });
  const remove = useMutation({
    mutationFn: () => deleteConversationForMe(cid),
    onSuccess: async () => {
      setConfirm(null); onClose();
      await qc.invalidateQueries({ queryKey: keys.conversations });
      navigate('/app/chats');
    },
    onError: (e) => { setConfirm(null); setError(e.message); },
  });

  const muted = isMuted(conv);
  const activeMute = !muted ? 0 : conv.muted_until?.startsWith('9999') ? 3 : -1;

  return (
    <>
      <Dialog open onClose={onClose} title="Chat settings" size="sm" description="These settings apply to your account only unless stated otherwise.">
        <div className={styles.menu}>
          <button onClick={() => { prefs.mutate({ pinned_at: conv.pinned_at ? null : new Date().toISOString() }); onClose(); }}>
            {conv.pinned_at ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />}
            {conv.pinned_at ? 'Unpin from top' : 'Pin to top'}
          </button>
          <button onClick={() => { prefs.mutate({ archived_at: conv.archived_at ? null : new Date().toISOString() }); onClose(); }}>
            {conv.archived_at ? <ArchiveRestore size={18} aria-hidden /> : <Archive size={18} aria-hidden />}
            {conv.archived_at ? 'Unarchive chat' : 'Archive chat'}
          </button>
          <button onClick={() => { unread.mutate(); onClose(); }}><MailOpen size={18} aria-hidden /> Mark as unread</button>
          {onOpenSearch && <button onClick={() => { onClose(); onOpenSearch(); }}><Search size={18} aria-hidden /> Search in conversation</button>}
          {onOpenMedia && <button onClick={() => { onClose(); onOpenMedia(); }}><Images size={18} aria-hidden /> Shared media and files</button>}
          <div className={styles.menuLabel}>Notifications</div>
          <div className={`${styles.muteGrid}`}>
            {MUTES.map((m, i) => (
              <button key={m.label} aria-pressed={activeMute === i} className={activeMute === i ? styles.muteActive : undefined}
                onClick={() => prefs.mutate({ muted_until: until(m.ms) })}>
                {m.ms === 0 ? <BellRing size={16} aria-hidden /> : <BellOff size={16} aria-hidden />}{m.label}
              </button>
            ))}
          </div>
          {muted && activeMute === -1 && (
            <p className={styles.sectionNote}>Muted until {conv.muted_until ? formatDateTime(conv.muted_until) : 'later'}. Choose a duration or On to change it.</p>
          )}
          <div className={styles.menuLabel}>History</div>
          <button className={styles.danger} onClick={() => setConfirm('clear')}><Trash2 size={18} aria-hidden /> Clear history for me</button>
          <button className={styles.danger} onClick={() => setConfirm('delete')}><Trash2 size={18} aria-hidden /> Delete chat for me</button>
          <p className={styles.sectionNote}>
            Clearing removes the visible history for you only. Deleting removes the conversation from your list until a new message arrives. Other members keep their copy.
          </p>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </Dialog>

      <ConfirmDialog
        open={confirm === 'clear'} onClose={() => setConfirm(null)} onConfirm={() => clear.mutate()}
        loading={clear.isPending} destructive title="Clear this conversation for you?" confirmLabel="Clear history"
      >
Messages you have already seen will be hidden for you, and the conversation disappears from your list until someone sends something new. Other members are not affected. This cannot be undone.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'delete'} onClose={() => setConfirm(null)} onConfirm={() => remove.mutate()}
        loading={remove.isPending} destructive title="Delete this chat for you?" confirmLabel="Delete chat"
      >
        The chat will disappear from your list. Messages and media that other members still have are not deleted. A new message from this conversation can make it reappear.
      </ConfirmDialog>
      <div className="sr-only" aria-live="polite">{prefs.isPending || unread.isPending ? 'Saving chat settings' : ''}</div>
    </>
  );
}
