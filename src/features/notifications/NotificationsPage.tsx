import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, MessageCircle, Phone, PhoneMissed, Trash2, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/Button/Button';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { Skeleton } from '@/components/Skeleton/Skeleton';
import {
  deleteNotification, fetchNotifications, markAllNotificationsRead, markNotificationRead,
  safeNotificationUrl, type AppNotification,
} from './api';
import { formatDateTime } from '@/features/chat/format';
import styles from './NotificationsPage.module.css';

const ICONS = {
  message: MessageCircle, call: Phone, missed_call: PhoneMissed,
  group_call: Users, contact_request: UserPlus, system: Bell,
} as const;

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const q = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const remove = useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const open = (n: AppNotification) => {
    void markNotificationRead(n.id).then(() => qc.invalidateQueries({ queryKey: ['notifications'] })).catch(() => {});
    navigate(safeNotificationUrl(n.url));
  };

  const list = useMemo(() => (q.data ?? []).filter((n) => tab === 'all' || !n.read_at), [q.data, tab]);
  const unread = (q.data ?? []).filter((n) => !n.read_at).length;

  return (
    <section className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1>Notifications</h1>
          <p>{unread ? `${unread} unread` : 'You’re all caught up.'}</p>
        </div>
        <Button variant="secondary" onClick={() => markAll.mutate()} disabled={!unread} loading={markAll.isPending}>Mark all read</Button>
      </header>
      <div className={styles.tabs} role="group" aria-label="Filter notifications">
        {(['all', 'unread'] as const).map((t) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'all' ? 'All' : 'Unread'}</button>
        ))}
      </div>

      {q.isLoading && <div className={styles.loading} role="status" aria-label="Loading notifications"><Skeleton height="3.5rem" /><Skeleton height="3.5rem" /><Skeleton height="3.5rem" /></div>}
      {q.isError && <p className={styles.err} role="alert">Could not load notifications. <button onClick={() => q.refetch()}>Retry</button></p>}
      {q.isSuccess && list.length === 0 && (
        <EmptyState variant={tab === 'unread' ? 'saved' : 'chat'} title={tab === 'unread' ? 'Nothing unread' : 'No notifications yet'}>
          Message, call and contact-request notifications will appear here.
        </EmptyState>
      )}
      <ul className={styles.list}>
        {list.map((n) => {
          const Icon = ICONS[n.kind] ?? Bell;
          return (
            <li key={n.id} className={styles.row} data-unread={!n.read_at}>
              <button className={styles.main} onClick={() => open(n)}>
                <span className={styles.icon}><Icon size={18} aria-hidden /></span>
                <span className={styles.copy}>
                  <span className={styles.top}><strong>{n.title}</strong><time dateTime={n.created_at}>{formatDateTime(n.created_at)}</time></span>
                  <span className={styles.body}>{n.body}</span>
                </span>
                {!n.read_at && <span className={styles.dot} aria-label="Unread" />}
              </button>
              <button className={styles.delete} onClick={() => remove.mutate(n.id)} aria-label={`Delete notification: ${n.title}`}>
                <Trash2 size={15} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
