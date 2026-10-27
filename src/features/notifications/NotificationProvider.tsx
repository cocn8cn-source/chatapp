import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, MessageCircle, PhoneMissed, Phone, Users, UserPlus, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import { useAuth } from '@/stores/auth';
import { keys, fetchMyProfile } from '@/features/chat/api';
import {
  fetchNotifications, markConversationNotificationsRead, markNotificationRead, safeNotificationUrl,
  type AppNotification,
} from './api';
import { syncPushSubscription } from '@/lib/push';
import { playNotificationSound } from './sound';
import styles from './Notifications.module.css';

const KIND_ICON = {
  message: MessageCircle, call: Phone, missed_call: PhoneMissed,
  group_call: Users, contact_request: UserPlus, system: Bell,
} as const;

function Toast({ n, onOpen, onClose }: { n: AppNotification; onOpen: (n: AppNotification) => void; onClose: (id: string) => void }) {
  const Icon = KIND_ICON[n.kind] ?? Bell;
  return (
    <div className={styles.toast}>
      <button className={styles.toastMain} onClick={() => onOpen(n)}>
        <span className={styles.toastIcon}><Icon size={18} aria-hidden /></span>
        <span className={styles.toastCopy}>
          <strong>{n.title}</strong>
          <span>{n.body}</span>
        </span>
      </button>
      <button className={styles.toastClose} onClick={() => onClose(n.id)} aria-label="Dismiss notification"><X size={14} aria-hidden /></button>
    </div>
  );
}

/** Mounted inside the authenticated shell. Shows toasts, sounds and keeps badge counts fresh. */
export function NotificationProvider() {
  const uid = useAuth((s) => s.session?.user.id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const shown = useRef(new Set<string>());
  const profile = useQuery({ queryKey: keys.myProfile, queryFn: fetchMyProfile, staleTime: 120_000 });

  const q = useQuery({ queryKey: keys.notifications, queryFn: fetchNotifications, enabled: !!uid, staleTime: 20_000 });
  useEffect(() => {
    if (q.data) q.data.forEach((n) => shown.current.add(n.id));
  }, [q.data]);

  // Re-register this device for the signed-in account (silent; never prompts).
  useEffect(() => { if (uid) void syncPushSubscription(); }, [uid]);

  const activeConversation = location.pathname.startsWith('/app/chats/') ? location.pathname.split('/')[3] : null;
  const activeRef = useRef<string | null>(null);
  const soundRef = useRef(true);

  useEffect(() => { activeRef.current = activeConversation; }, [activeConversation]);
  useEffect(() => { soundRef.current = profile.data?.notification_sound ?? true; }, [profile.data]);

  const dismiss = useCallback((id: string) => setToasts((cur) => cur.filter((t) => t.id !== id)), []);
  const open = useCallback((n: AppNotification) => {
    setToasts((cur) => cur.filter((t) => t.id !== n.id));
    void markNotificationRead(n.id).then(() => qc.invalidateQueries({ queryKey: keys.notifications })).catch(() => {});
    navigate(safeNotificationUrl(n.url));
  }, [navigate, qc]);

  useEffect(() => {
    if (!supabase || !uid) return;
    const channel = createChannel(`notifications:${uid}`);
    if (!channel) return;
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (p) => {
        const n = p.new as AppNotification;
        if (shown.current.has(n.id)) return;
        shown.current.add(n.id);
        qc.setQueryData<AppNotification[]>(keys.notifications, (cur) => [n, ...(cur ?? []).filter((x) => x.id !== n.id)]);
        if (document.visibilityState !== 'visible') return;
        const isActiveChat = n.conversation_id && n.conversation_id === activeRef.current && n.kind === 'message';
        if (isActiveChat) {
          void markConversationNotificationsRead(n.conversation_id!).catch(() => {});
          return;
        }
        if (soundRef.current) playNotificationSound();
        setToasts((cur) => [n, ...cur.filter((t) => t.id !== n.id)].slice(0, 3));
        window.setTimeout(() => dismiss(n.id), 7_000);
      })
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [uid, qc, dismiss]);

  return (
    <div className={styles.toastStack} aria-live="polite" aria-label="Notifications">
      {toasts.map((n) => <Toast key={n.id} n={n} onOpen={open} onClose={dismiss} />)}
    </div>
  );
}
