import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, MessageCircle, Phone, Settings, Users } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/stores/auth';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import { Avatar } from '@/components/Avatar/Avatar';
import { Logo } from '@/components/Logo/Logo';
import { fetchConversations, fetchMyProfile, keys } from '@/features/chat/api';
import { isMuted } from '@/features/chat/conversationList';
import { callKeys, fetchCallHistory } from '@/features/calls/api';
import { CallProvider } from '@/features/calls/CallProvider';
import { countMissed, lastSeen } from '@/features/calls/missed';
import { fetchNotifications } from '@/features/notifications/api';
import { NotificationProvider } from '@/features/notifications/NotificationProvider';
import { PresenceProvider } from '@/features/presence/PresenceProvider';
import { GroupCallOverlay } from '@/features/calls/GroupCallOverlay';
import styles from './AppShell.module.css';

export function AppShell() {
  const uid = useAuth((s) => s.session!.user.id);
  const path = useLocation().pathname;
  const profile = useQuery({ queryKey: keys.myProfile, queryFn: fetchMyProfile });
  const conversations = useQuery({ queryKey: keys.conversations, queryFn: fetchConversations });
  const notifications = useQuery({ queryKey: keys.notifications, queryFn: fetchNotifications });
  const history = useQuery({ queryKey: callKeys.history, queryFn: fetchCallHistory });
  const qc = useQueryClient();

  // Live inbox for the whole signed-in app: previews, ordering, unread badges and read
  // receipts on every screen, not only while a conversation is open. RLS limits each
  // event to conversations this account belongs to.
  useEffect(() => {
    const channel = createChannel(`inbox:${uid}`);
    if (!channel) return;
    const refresh = () => { void qc.invalidateQueries({ queryKey: keys.conversations }); };
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_reads' }, refresh)
      .subscribe();
    return () => { void supabase?.removeChannel(channel); };
  }, [uid, qc]);

  const unreadMessages = (conversations.data ?? []).reduce((n, c) => n + (isMuted(c) ? 0 : c.unread), 0);
  const unreadNotifications = (notifications.data ?? []).filter((n) => !n.read_at).length;
  const onCalls = path.startsWith('/app/calls');
  const missed = onCalls || !history.data ? 0 : countMissed(history.data, uid, lastSeen(uid));
  const items = [
    { to: '/app/chats', label: 'Chats', Icon: MessageCircle, badge: unreadMessages, tone: 'accent' as const },
    { to: '/app/people', label: 'People', Icon: Users, badge: 0, tone: 'accent' as const },
    { to: '/app/calls', label: 'Calls', Icon: Phone, badge: missed, tone: 'error' as const },
    { to: '/app/notifications', label: 'Alerts', Icon: Bell, badge: unreadNotifications, tone: 'accent' as const },
    { to: '/app/settings', label: 'Settings', Icon: Settings, badge: 0, tone: 'accent' as const },
  ];

  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main-content">Skip to content</a>
      <nav className={styles.nav} aria-label="Main navigation">
        <NavLink to="/app/chats" className={styles.logo} aria-label="ChatSpace chats">
          <Logo size={44} tone="dark" />
        </NavLink>
        <div className={styles.navItems}>
          {items.map(({ to, label, Icon, badge, tone }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}
              aria-label={badge > 0 ? `${label}, ${badge} unread` : label}
            >
              <span className={styles.iconWrap}>
                <Icon size={21} aria-hidden />
                {badge > 0 && <span className={`${styles.badge} ${tone === 'error' ? styles.badgeError : ''}`} aria-hidden>{badge > 9 ? '9+' : badge}</span>}
              </span>
              <span className={styles.label}>{label}</span>
            </NavLink>
          ))}
        </div>
        <NavLink to="/app/settings" className={styles.me} aria-label={profile.data ? `Settings for ${profile.data.display_name}` : 'Account settings'}>
          {profile.data
            ? <Avatar name={profile.data.display_name} path={profile.data.avatar_path} size={36} />
            : <span className={styles.meFallback} aria-hidden />}
        </NavLink>
      </nav>

      <main className={styles.content} id="main-content" tabIndex={-1}>
        <Outlet />
      </main>

      <PresenceProvider />
      <NotificationProvider />
      <CallProvider />
      <GroupCallOverlay />
    </div>
  );
}
