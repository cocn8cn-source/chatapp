import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BellOff, MessageSquarePlus, Pin, Plus, Search, Star, Users } from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { ConversationListSkeleton } from '@/components/Skeleton/Skeleton';
import { EnableNotifications } from '@/features/notifications/EnableNotifications';
import { usePresenceStore } from '@/features/presence/presenceStore';
import { isOnline } from '@/features/presence/presence';
import { isMissingSchemaObject } from '@/lib/errors';
import { fetchConversations, keys, searchMessages } from './api';
import { isMuted, visibleConversations, type ListTab } from './conversationList';
import { formatListTime } from './format';
import { NewChatDialog } from './NewChatDialog';
import { ThreadView } from './ThreadView';
import styles from './ChatsPage.module.css';

const NOTIFY_PROMPT = 'chatspace-notify-prompt-dismissed';

export function ChatsPage() {
  const uid = useAuth((s) => s.session!.user.id);
  const { conversationId } = useParams();
  const [searchParams] = useSearchParams();
  const messageParam = searchParams.get('message') ?? '';
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<ListTab>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [notifyDismissed, setNotifyDismissed] = useState(() => {
    try { return localStorage.getItem(NOTIFY_PROMPT) === '1'; } catch { return false; }
  });
  const presence = usePresenceStore((s) => s.byId);

  const convs = useQuery({ queryKey: keys.conversations, queryFn: fetchConversations });
  const shown = useMemo(() => visibleConversations(convs.data ?? [], tab, filter), [convs.data, tab, filter]);
  const term = filter.trim();
  const hits = useQuery({ queryKey: keys.search(term), queryFn: () => searchMessages(term), enabled: term.length >= 2 });
  const active = convs.data?.find((c) => c.id === conversationId);
  const nameOf = (cid: string) => {
    const c = convs.data?.find((x) => x.id === cid);
    return c?.title ?? c?.peer_display_name ?? 'Conversation';
  };
  const unread = (convs.data ?? []).reduce((n, c) => n + (isMuted(c) ? 0 : c.unread), 0);

  const dismissNotify = () => {
    setNotifyDismissed(true);
    try { localStorage.setItem(NOTIFY_PROMPT, '1'); } catch { /* storage unavailable */ }
  };

  return (
    <div className={styles.wrap} data-thread={conversationId ? 'open' : 'closed'}>
      <aside className={styles.list} aria-label="Conversations">
        <div className={styles.listHead}>
          <div>
            <h1 className={styles.h}>Chats {unread > 0 && <span className={styles.total} aria-label={`${unread} unread messages`}>{unread > 99 ? '99+' : unread}</span>}</h1>
          </div>
          <div className={styles.headActions}>
            <Link to="/app/saved" className={styles.iconLink} aria-label="Saved messages" title="Saved messages"><Star size={18} aria-hidden /></Link>
            <Button onClick={() => setNewOpen(true)} aria-label="Start a new chat or group"><Plus size={18} aria-hidden /><span className={styles.newLabel}>New</span></Button>
          </div>
        </div>

        <label className={styles.search}>
          <Search size={17} aria-hidden />
          <span className="sr-only">Search conversations and messages</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search chats and messages" autoCapitalize="none" />
        </label>

        <div className={styles.tabs} role="group" aria-label="Filter conversations">
          {(['all', 'unread', 'archived'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={tab === v} onClick={() => setTab(v)}>
              {v === 'all' ? 'All' : v === 'unread' ? 'Unread' : 'Archived'}
              {v === 'unread' && unread > 0 && <span className={styles.tabCount}>{unread > 99 ? '99+' : unread}</span>}
            </button>
          ))}
        </div>

        <div className={styles.listBody}>
          {!notifyDismissed && <div className={styles.notifyWrap}><EnableNotifications variant="banner" onDismiss={dismissNotify} /></div>}

          {convs.isLoading && <ConversationListSkeleton rows={7} />}
          {convs.isError && (
            <div className={styles.error} role="alert">
              <p>Could not load chats. <button type="button" onClick={() => convs.refetch()}>Retry</button></p>
              {isMissingSchemaObject(convs.error) && (
                <p className={styles.errorHint}>
                  This project’s database is missing the ChatSpace functions. Apply the migrations in
                  <code> supabase/migrations </code> (0001 → 0006) in the Supabase SQL Editor, then retry.
                </p>
              )}
            </div>
          )}
          {convs.isSuccess && shown.length === 0 && !filter && (
            <div className={styles.emptyList}>
              <EmptyState
                compact variant="chat"
                title={tab === 'unread' ? 'You are all caught up' : tab === 'archived' ? 'No archived chats' : 'Start your first conversation'}
                action={tab === 'all' ? <Button onClick={() => setNewOpen(true)}><MessageSquarePlus size={16} aria-hidden /> New chat</Button> : undefined}
              >
                {tab === 'unread' ? 'New unread messages will show up here.' : tab === 'archived' ? 'Chats you archive stay out of the way until you need them.' : 'Find someone by username or create a group to get going.'}
              </EmptyState>
            </div>
          )}
          {convs.isSuccess && shown.length === 0 && filter && (
            <p className={styles.noResults}>No conversations match “{filter}”.</p>
          )}

          <ul className={styles.items}>
            {shown.map((c) => {
              const name = c.kind === 'group' ? c.title ?? 'Group' : c.peer_display_name ?? 'Conversation';
              const online = c.kind === 'direct'
                ? isOnline(c.peer_id ? presence[c.peer_id] : undefined)
                : null;
              const last = c.last_message_preview ?? 'No messages yet';
              return (
                <li key={c.id}>
                  <Link
                    to={`/app/chats/${c.id}`}
                    className={`${styles.row} ${c.id === conversationId ? styles.rowActive : ''}`}
                    aria-current={c.id === conversationId ? 'page' : undefined}
                  >
                    <Avatar name={name} path={c.kind === 'group' ? c.photo_path : c.peer_avatar_path} bucket={c.kind === 'group' ? 'group-photos' : 'avatars'} size={48} online={online} />
                    <span className={styles.rowText}>
                      <span className={styles.rowTop}>
                        <strong>{name}</strong>
                        <time dateTime={c.last_message_at ?? undefined}>{formatListTime(c.last_message_at)}</time>
                      </span>
                      <span className={styles.previewRow}>
                        {c.kind === 'group' && <Users size={13} aria-hidden className={styles.kindIcon} />}
                        <span className={styles.preview}>{last}</span>
                        {c.pinned_at && <Pin size={13} aria-label="Pinned conversation" className={styles.metaIcon} />}
                        {isMuted(c) && <BellOff size={13} aria-label="Muted" className={styles.metaIcon} />}
                        {c.unread > 0 && (
                          <span className={`${styles.badge} ${isMuted(c) ? styles.badgeMuted : ''}`} aria-label={`${c.unread} unread`}>
                            {c.unread > 99 ? '99+' : c.unread}
                          </span>
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {term.length >= 2 && (
            <section className={styles.messageHits} aria-labelledby="message-hits">
              <h2 id="message-hits">Messages</h2>
              {hits.isLoading && <p className={styles.noResults} role="status">Searching messages…</p>}
              {hits.isError && <p className={styles.error} role="alert">Message search failed.</p>}
              {hits.data?.length === 0 && <p className={styles.noResults}>No messages match “{term}”.</p>}
              <ul>
                {hits.data?.map((h) => (
                  <li key={h.id}>
                    <Link to={`/app/chats/${h.conversation_id}?message=${h.id}`} className={styles.hit}>
                      <span className={styles.hitTop}><strong>{nameOf(h.conversation_id)}</strong><time>{formatListTime(h.created_at)}</time></span>
                      <span className={styles.hitBody}>{h.body || 'Attachment'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>

      <section className={styles.canvas} aria-label="Conversation">
        {conversationId && convs.isLoading && (
          <div className={styles.canvasState}><p className={styles.canvasNote} role="status">Opening conversation…</p></div>
        )}
        {conversationId && convs.isSuccess && !active && (
          <div className={`grid-surface ${styles.placeholder}`}>
            <EmptyState variant="lock" title="Conversation unavailable" action={<Link to="/app/chats" className={styles.plainLink}><Button variant="secondary">Back to chats</Button></Link>}>
              It may have been deleted, or your account is no longer a member.
            </EmptyState>
          </div>
        )}
        {conversationId && active && <ThreadView key={`${conversationId}:${messageParam}`} conv={active} uid={uid} />}
        {!conversationId && (
          <div className={`grid-surface ${styles.placeholder}`}>
            <div className={styles.placeholderInner}>
              <EmptyState
                variant="chat"
                title="Pick up where you left off"
                action={<Button onClick={() => setNewOpen(true)}><MessageSquarePlus size={16} aria-hidden /> Start a conversation</Button>}
              >
                Choose a chat from the list, or start a new private chat or group. Messages sync in real time.
              </EmptyState>
              <div className={styles.featureRow}>
                <span>Private media</span><span>Read receipts</span><span>Voice notes</span><span>Calls</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {newOpen && <NewChatDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}
