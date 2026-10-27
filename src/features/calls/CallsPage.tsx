import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PhoneIncoming, PhoneMissed, PhoneOutgoing, Phone, Video } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { Avatar } from '@/components/Avatar/Avatar';
import { formatDuration } from '@/features/chat/media/validation';
import { callKeys, fetchCallHistory, type CallHistoryItem } from './api';
import { startOutgoing } from './callEngine';
import { isBusy } from './callMachine';
import { useCall } from './callStore';
import { markCallsSeen } from './missed';
import styles from './CallsPage.module.css';

function describe(c: CallHistoryItem, mine: string): { label: string; Icon: typeof Phone } {
  const outgoing = c.caller_id === mine;
  const dur = c.answered_at && c.ended_at ? formatDuration(new Date(c.ended_at).getTime() - new Date(c.answered_at).getTime()) : null;
  switch (c.status) {
    case 'ended': return { label: `${outgoing ? 'Outgoing' : 'Incoming'}${dur ? ` · ${dur}` : ''}`, Icon: outgoing ? PhoneOutgoing : PhoneIncoming };
    case 'missed': return { label: outgoing ? 'No answer' : 'Missed', Icon: PhoneMissed };
    case 'rejected': return { label: outgoing ? 'Declined by them' : 'You declined', Icon: outgoing ? PhoneOutgoing : PhoneIncoming };
    case 'cancelled': return { label: outgoing ? 'Cancelled' : 'Missed', Icon: outgoing ? PhoneOutgoing : PhoneMissed };
    case 'failed': return { label: 'Failed to connect', Icon: PhoneMissed };
    default: return { label: 'In progress', Icon: outgoing ? PhoneOutgoing : PhoneIncoming };
  }
}

export function CallsPage() {
  const uid = useAuth((s) => s.session!.user.id);
  const busy = useCall((s) => isBusy(s.machine.phase));
  const q = useQuery({ queryKey: callKeys.history, queryFn: fetchCallHistory });
  useEffect(() => { markCallsSeen(uid); }, [uid, q.dataUpdatedAt]);

  return (
    <section className={styles.page}>
      <h1>Calls</h1>
      {q.isLoading && <p role="status" className={styles.muted}>Loading call history…</p>}
      {q.isError && <p role="alert" className={styles.err}>Could not load calls. <button onClick={() => q.refetch()}>Retry</button></p>}
      {q.isSuccess && q.data.length === 0 && (
        <div className={`grid-surface ${styles.empty}`}><div><h2>No calls yet</h2><p>Open a chat and use the phone or video button to call.</p></div></div>
      )}
      <ul className={styles.list}>
        {q.data?.map((c) => {
          const { label, Icon } = describe(c, uid);
          const missed = c.status === 'missed' || (c.status === 'cancelled' && c.callee_id === uid);
          return (
            <li key={c.id} className={styles.row}>
              <Avatar name={c.peer_display_name || 'Unknown'} path={c.peer_avatar_path} />
              <span className={styles.info}>
                <strong>{c.peer_display_name || 'Unknown'}</strong>
                <span className={missed ? styles.missed : styles.muted}><Icon size={14} aria-hidden /> {label} · {c.kind === 'video' ? 'Video' : 'Voice'}</span>
              </span>
              <time className={styles.muted}>{new Date(c.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
              <button className={styles.call} disabled={busy || !c.peer_id} aria-label={`Voice call ${c.peer_display_name || ''}`} onClick={() => void startOutgoing(c.conversation_id, c.peer_id, 'voice')}><Phone size={18} aria-hidden /></button>
              <button className={styles.call} disabled={busy || !c.peer_id} aria-label={`Video call ${c.peer_display_name || ''}`} onClick={() => void startOutgoing(c.conversation_id, c.peer_id, 'video')}><Video size={18} aria-hidden /></button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
