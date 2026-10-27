import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Flag, MessageCircle, Settings, ShieldOff, UserCheck, UserMinus, UserPlus, X } from 'lucide-react';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import {
  blockUser, fetchProfileCard, keys, removeContact, respondContactRequest, sendContactRequest,
  startDirectChat, unblockUser,
} from '@/features/chat/api';
import { useAuth } from '@/stores/auth';
import { usePresenceStore } from '@/features/presence/presenceStore';
import { presenceLabel } from '@/features/presence/presence';
import { ReportDialog } from '@/features/moderation/ReportDialog';
import styles from './ProfileView.module.css';

export function ProfileView({ userId, onClose }: { userId: string; onClose?: () => void }) {
  const me = useAuth((s) => s.session!.user.id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const presence = usePresenceStore((s) => s.byId[userId]);
  const q = useQuery({ queryKey: keys.profileCard(userId), queryFn: () => fetchProfileCard(userId) });
  const [error, setError] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.profileCard(userId) });
    void qc.invalidateQueries({ queryKey: keys.contacts });
    void qc.invalidateQueries({ queryKey: keys.blocked });
    void qc.invalidateQueries({ queryKey: keys.conversations });
  };

  const addContact = useMutation({
    mutationFn: (username: string) => sendContactRequest(username),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => respondContactRequest(id, accept),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeContact(id),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const block = useMutation({
    mutationFn: (id: string) => blockUser(id),
    onSuccess: () => { setBlockOpen(false); refresh(); },
    onError: (e) => setError(e.message),
  });
  const unblock = useMutation({
    mutationFn: (id: string) => unblockUser(id),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const openChat = useMutation({
    mutationFn: async (username: string) => {
      const cid = await startDirectChat(username);
      await qc.invalidateQueries({ queryKey: keys.conversations });
      return cid;
    },
    onSuccess: (cid) => { onClose?.(); navigate(`/app/chats/${cid}`); },
    onError: (e) => setError(e.message),
  });

  if (q.isLoading) return <p className={styles.note} role="status">Loading profile…</p>;
  if (q.isError) return <p className={styles.err} role="alert">Could not load this profile. <button onClick={() => q.refetch()}>Retry</button></p>;
  if (!q.data) {
    return <EmptyState variant="lock" title="Profile unavailable" compact>This profile cannot be viewed, or the person has blocked you.</EmptyState>;
  }
  const c = q.data;
  const pendingFromMe = c.contact_request_status === 'pending' && c.contact_request_from_me;
  const pendingFromThem = c.contact_request_status === 'pending' && !c.contact_request_from_me;
  const canMessage = !c.blocked_me && !c.blocked_by_me && (c.accepts_messages || c.is_contact);
  const self = c.id === me;

  return (
    <div className={styles.profile}>
      <div className={styles.hero}>
        <Avatar name={c.display_name} path={c.avatar_path} size={96} online={c.is_self ? undefined : presence ? presence.online : null} />
        <div className={styles.identity}>
          <h2>{c.display_name}</h2>
          <p>@{c.username}</p>
          <div className={styles.relationship}>
            {c.is_contact && <span className={styles.pill}><UserCheck size={12} aria-hidden /> Contact</span>}
            {!c.is_self && <span className={styles.presence}>{presenceLabel(presence)}</span>}
          </div>
        </div>
      </div>

      {c.about && <p className={styles.about}>{c.about}</p>}
      {c.blocked_me && <p className={styles.warning} role="status">You can’t message or call this person from this account.</p>}
      {c.blocked_by_me && <p className={styles.warning} role="status">You blocked this person. Unblock them to message or call again.</p>}
      {!c.accepts_messages && !c.is_contact && !c.blocked_me && (
        <p className={styles.warning}>This person only accepts messages from contacts. Send a contact request first.</p>
      )}

      {error && <p className={styles.err} role="alert">{error}</p>}

      {self ? (
        <div className={styles.actions}>
          <Link to="/app/settings" className={styles.linkButton}><Button variant="secondary"><Settings size={16} aria-hidden /> Edit your profile</Button></Link>
          {onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}
        </div>
      ) : (
        <>
          <div className={styles.actions}>
            {canMessage && (
              <Button onClick={() => openChat.mutate(c.username)} loading={openChat.isPending}>
                <MessageCircle size={16} aria-hidden /> Message
              </Button>
            )}
            {!c.is_contact && !pendingFromMe && !c.contact_request_status && !c.blocked_me && !c.blocked_by_me && (
              <Button variant="secondary" onClick={() => addContact.mutate(c.username)} loading={addContact.isPending}>
                <UserPlus size={16} aria-hidden /> Add contact
              </Button>
            )}
            {pendingFromMe && <Button variant="secondary" disabled><Clock size={16} aria-hidden /> Request sent</Button>}
            {pendingFromThem && c.contact_request_id && (
              <>
                <Button onClick={() => respond.mutate({ id: c.contact_request_id!, accept: true })} loading={respond.isPending}>
                  <Check size={16} aria-hidden /> Accept request
                </Button>
                <Button variant="secondary" onClick={() => respond.mutate({ id: c.contact_request_id!, accept: false })} disabled={respond.isPending}>
                  <X size={16} aria-hidden /> Decline
                </Button>
              </>
            )}
            {c.is_contact && (
              <Button variant="ghost" onClick={() => remove.mutate(c.id)} loading={remove.isPending}>
                <UserMinus size={16} aria-hidden /> Remove contact
              </Button>
            )}
            {onClose && <Button variant="ghost" onClick={onClose}>Close</Button>}
          </div>
          <div className={styles.safety}>
            {c.blocked_by_me ? (
              <Button variant="secondary" onClick={() => unblock.mutate(c.id)} loading={unblock.isPending}>Unblock</Button>
            ) : !c.blocked_me ? (
              <Button variant="secondary" onClick={() => setBlockOpen(true)}><ShieldOff size={16} aria-hidden /> Block</Button>
            ) : null}
            <Button variant="secondary" onClick={() => setReportOpen(true)}><Flag size={16} aria-hidden /> Report</Button>
          </div>
        </>
      )}

      {reportOpen && <ReportDialog open onClose={() => setReportOpen(false)} userId={c.id} name={c.display_name} />}
      <ConfirmDialog
        open={blockOpen} onClose={() => setBlockOpen(false)}
        onConfirm={() => block.mutate(c.id)} loading={block.isPending}
        title={`Block ${c.display_name}?`} confirmLabel="Block" destructive
      >
        They will not be able to message or call you, and any contact relationship is removed. You can unblock them later.
      </ConfirmDialog>
    </div>
  );
}
