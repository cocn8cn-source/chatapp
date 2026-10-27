import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Info, MoreVertical, Phone, Pin, Search, Video, X,
} from 'lucide-react';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { Dialog } from '@/components/Dialog/Dialog';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { IconButton } from '@/components/IconButton/IconButton';
import { MessageListSkeleton } from '@/components/Skeleton/Skeleton';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import { startOutgoing } from '@/features/calls/callEngine';
import { isBusy } from '@/features/calls/callMachine';
import { useCall } from '@/features/calls/callStore';
import { startGroupCall, joinGroupCall } from '@/features/calls/groupCall';
import { useGroupCall } from '@/features/calls/groupCallStore';
import { usePresenceStore } from '@/features/presence/presenceStore';
import { presenceLabel } from '@/features/presence/presence';
import { ReportDialog } from '@/features/moderation/ReportDialog';
import { ProfileDialog } from '@/features/profile/ProfileDialog';
import {
  fetchActiveGroupCall, fetchMembers, fetchMyProfile, fetchPinned, fetchReadCounts, keys, searchMessages,
  type ConversationItem, type GroupCall, type Message, type ReplyPreview,
} from './api';
import { dayKey, formatDay, messageSummary } from './format';
import { typingLabel } from './typing';
import { useTyping } from './useTyping';
import { useThread } from './useThread';
import { Composer } from './Composer';
import { MessageBubble } from './MessageBubble';
import { MessageActions } from './MessageActions';
import { ForwardDialog } from './ForwardDialog';
import { MediaGallery } from './media/MediaGallery';
import { GroupInfoDialog } from './GroupInfoDialog';
import { ConversationMenu } from './ConversationMenu';
import styles from './ThreadView.module.css';

function typingNames(ids: string[], nameOf: (id: string) => string): string[] {
  return ids.map(nameOf).filter(Boolean);
}

function toReply(m: Message): ReplyPreview {
  return {
    id: m.id, sender_id: m.sender_id, body: m.body, deleted_at: m.deleted_at ?? null,
    attachments: (m.attachments ?? []).map((a) => ({ kind: a.kind })),
  };
}

export function ThreadView({ conv, uid }: { conv: ConversationItem; uid: string }) {
  const cid = conv.id;
  const isGroup = conv.kind === 'group';
  const title = isGroup ? (conv.title ?? 'Group') : (conv.peer_display_name ?? 'Conversation');
  const t = useThread(cid, uid);
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const inCall = useCall((c) => isBusy(c.machine.phase));
  const groupStatus = useGroupCall((s) => s.status);
  const presence = usePresenceStore((s) => (conv.peer_id ? s.byId[conv.peer_id] : undefined));
  const profile = useQuery({ queryKey: keys.myProfile, queryFn: fetchMyProfile, staleTime: 120_000 });
  const members = useQuery({ queryKey: keys.members(cid), queryFn: () => fetchMembers(cid), enabled: isGroup });
  const typing = useTyping(cid, uid);
  const activeGroup = useQuery({
    queryKey: keys.activeGroupCall(cid), queryFn: () => fetchActiveGroupCall(cid),
    enabled: isGroup, staleTime: 8_000,
  });
  const pins = useQuery({ queryKey: keys.pins(cid), queryFn: () => fetchPinned(cid) });
  const readCounts = useQuery({ queryKey: keys.readCounts(cid), queryFn: () => fetchReadCounts(cid), enabled: isGroup });

  const [view, setView] = useState<'chat' | 'media'>('chat');
  const [editing, setEditing] = useState<{ m: Message; text: string } | null>(null);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [reply, setReply] = useState<Message | null>(null);
  const [forwarding, setForwarding] = useState<Message | null>(null);
  const [reporting, setReporting] = useState<Message | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Message | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [pendingJump, setPendingJump] = useState<string | null>(() => searchParams.get('message'));
  const [jumpError, setJumpError] = useState<string | null>(null);
  const jumpAttempts = useRef(0);
  const hitTimer = useRef<number | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = t.messages[t.messages.length - 1]?.id;

  const hits = useQuery({
    queryKey: [...keys.search(term), cid],
    queryFn: () => searchMessages(term, cid),
    enabled: searchOpen && term.trim().length >= 2,
  });

  const memberMap = useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m])), [members.data]);
  const nameOf = (id: string) => id === uid ? 'You' : memberMap.get(id)?.display_name ?? conv.peer_display_name ?? 'Someone';
  const mentionNames = useMemo(() => {
    if (isGroup) return (members.data ?? []).map((m) => m.username);
    return [conv.peer_username, profile.data?.username].filter((x): x is string => !!x);
  }, [isGroup, members.data, conv.peer_username, profile.data?.username]);
  const pinnedIds = useMemo(() => new Set((pins.data ?? []).map((p) => p.message_id)), [pins.data]);
  const readCountMap = useMemo(() => new Map((readCounts.data ?? []).map((r) => [r.message_id, Number(r.read_count)])), [readCounts.data]);
  const latestPin = pins.data?.[0] ?? null;

  const subtitle = typing.typingUserIds.length > 0
    ? typingLabel(typingNames(typing.typingUserIds, nameOf))
    : isGroup
      ? `${conv.member_count} ${conv.member_count === 1 ? 'member' : 'members'}`
      : presenceLabel(presence);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);
  useEffect(() => { stick.current = true; }, [cid]);

  // Photos and videos change the scroll height after they finish loading. Without this the
  // view drifts up while it is supposed to stay pinned to the newest message.
  useEffect(() => {
    const el = scroller.current;
    const list = el?.querySelector('ul');
    if (!el || !list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(list);
    return () => ro.disconnect();
  }, [cid]);

  useEffect(() => {
    if (!supabase || !isGroup) return;
    const channel = createChannel(`group-call-banner:${cid}`);
    if (!channel) return;
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_calls', filter: `conversation_id=eq.${cid}` }, () => {
        void qc.invalidateQueries({ queryKey: keys.activeGroupCall(cid) });
      })
      .subscribe();
    return () => { void supabase!.removeChannel(channel); };
  }, [cid, isGroup, qc]);

  useEffect(() => {
    if (!pendingJump) return;
    const id = pendingJump;
    const el = document.querySelector(`[data-message-id="${id}"]`);
    if (el) {
      stick.current = false;
      const frame = window.requestAnimationFrame(() => {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setHighlight(id);
        setPendingJump(null);
        window.clearTimeout(hitTimer.current);
        hitTimer.current = window.setTimeout(() => setHighlight(null), 2600);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (t.hasOlder && !t.loadingOlder && jumpAttempts.current < 10) {
      jumpAttempts.current += 1;
      void t.loadOlder();
      return;
    }
    if (!t.isLoading && !t.loadingOlder) {
      const frame = window.requestAnimationFrame(() => {
        setJumpError('That message is no longer available, or it is outside the message history we could load.');
        setPendingJump(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    // t.loadOlder is intentionally read through this effect's dependency state to avoid an extra fetch loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, t.messages, t.hasOlder, t.loadingOlder, t.isLoading]);

  useEffect(() => () => window.clearTimeout(hitTimer.current), []);

  const jumpTo = (id: string) => {
    jumpAttempts.current = 0;
    setJumpError(null);
    setPendingJump(id);
  };

  const lastMineId = [...t.messages].reverse().find((m) => m.sender_id === uid && !m.deleted_at && !m.status)?.id;
  const seen = (m: Message) => !isGroup && !!conv.peer_last_read_at && conv.peer_last_read_at >= m.created_at;

  const saveEdit = async () => {
    if (!editing) return;
    const body = editing.text.trim();
    if (!body || body === editing.m.body) { setEditing(null); return; }
    try {
      setActionError(null);
      await t.edit(editing.m, body);
      setEditing(null);
    } catch {
      setActionError('Could not save the edit. Try again.');
    }
  };

  const deleteForEveryone = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await t.remove(deleteTarget);
      setDeleteTarget(null);
    } catch {
      setActionError('Could not delete the message. Try again.');
      setDeleteTarget(null);
    } finally { setDeleting(false); }
  };

  const react = (m: Message, emoji: string, on: boolean) => {
    void t.react(m, emoji, on).catch(() => setActionError('Could not update the reaction.'));
  };

  const callPeer = (kind: 'voice' | 'video') => {
    if (!conv.peer_id) return;
    void startOutgoing(cid, conv.peer_id, kind);
  };

  const startOrJoinGroup = (kind: 'voice' | 'video') => {
    const active = activeGroup.data;
    if (active) void joinGroupCall(active, title, conv.my_role === 'admin');
    else void startGroupCall(cid, kind, title);
  };

  const groupBusy = groupStatus === 'connecting' || groupStatus === 'connected' || groupStatus === 'reconnecting';
  const activeCall = activeGroup.data as GroupCall | null | undefined;
  const showPinned = latestPin?.messages;
  const count = t.messages.length;

  return (
    <div className={styles.thread}>
      <header className={styles.head}>
        <Link to="/app/chats" className={styles.back} aria-label="Back to chats"><ArrowLeft size={20} aria-hidden /></Link>
        <button type="button" className={styles.identity} onClick={() => (isGroup ? setInfoOpen(true) : setProfileOpen(true))} aria-label={`View ${isGroup ? 'group information' : `${title}'s profile`}`}>
          <Avatar name={title} path={isGroup ? conv.photo_path : conv.peer_avatar_path} bucket={isGroup ? 'group-photos' : 'avatars'} size={42} online={isGroup ? null : presence ? presence.online : false} />
          <span className={styles.identityText}>
            <strong>{title}</strong>
            <small className={typing.typingUserIds.length ? styles.typing : undefined}>{subtitle}</small>
          </span>
        </button>
        <div className={styles.tools}>
          {isGroup ? (
            <>
              {activeCall ? (
                <IconButton label={`Join ${activeCall.kind} call`} onClick={() => startOrJoinGroup(activeCall.kind)} disabled={groupBusy}>
                  {activeCall.kind === 'video' ? <Video size={19} aria-hidden /> : <Phone size={19} aria-hidden />}
                </IconButton>
              ) : (
                <>
                  <IconButton label="Start group voice call" onClick={() => startOrJoinGroup('voice')} disabled={groupBusy}><Phone size={19} aria-hidden /></IconButton>
                  <IconButton label="Start group video call" onClick={() => startOrJoinGroup('video')} disabled={groupBusy}><Video size={19} aria-hidden /></IconButton>
                </>
              )}
            </>
          ) : (
            <>
              <IconButton label="Voice call" onClick={() => callPeer('voice')} disabled={!conv.peer_id || inCall || conv.blocked || conv.blocked_by_peer}><Phone size={19} aria-hidden /></IconButton>
              <IconButton label="Video call" onClick={() => callPeer('video')} disabled={!conv.peer_id || inCall || conv.blocked || conv.blocked_by_peer}><Video size={19} aria-hidden /></IconButton>
            </>
          )}
          <IconButton className={styles.hideMobile} label="Search in conversation" active={searchOpen} onClick={() => { setSearchOpen((v) => !v); setTerm(''); setJumpError(null); }}><Search size={19} aria-hidden /></IconButton>
          <IconButton className={styles.hideMobile} label={isGroup ? 'Group information' : 'Profile'} onClick={() => (isGroup ? setInfoOpen(true) : setProfileOpen(true))}><Info size={19} aria-hidden /></IconButton>
          <IconButton label="Chat settings" onClick={() => setMenuOpen(true)}><MoreVertical size={19} aria-hidden /></IconButton>
        </div>
      </header>

      {searchOpen && (
        <div className={styles.search}>
          <div className={styles.searchBox}>
            <Search size={16} aria-hidden />
            <label className="sr-only" htmlFor="in-chat-search">Search this conversation</label>
            <input id="in-chat-search" placeholder="Search this conversation" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
            {term && <button type="button" onClick={() => setTerm('')} aria-label="Clear search"><X size={15} aria-hidden /></button>}
          </div>
          {jumpError && <p className={styles.jumpError} role="alert">{jumpError}</p>}
          {term.trim().length >= 2 && (
            <ul className={styles.hits} aria-live="polite">
              {hits.isLoading && <li className={styles.hitMuted}>Searching…</li>}
              {hits.isError && <li className={styles.hitMuted}>Search failed. Try again.</li>}
              {hits.data?.length === 0 && <li className={styles.hitMuted}>No messages match “{term.trim()}”.</li>}
              {hits.data?.map((h) => (
                <li key={h.id}>
                  <button className={styles.hit} onClick={() => { jumpTo(h.id); setTerm(''); }}>
                    <span>{h.body || 'Attachment'}</span>
                    <time>{new Date(h.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showPinned && (
        <div className={styles.pinBar}>
          <Pin size={14} aria-hidden />
          <button onClick={() => jumpTo(latestPin.message_id)} className={styles.pinMain}>
            <strong>Pinned message</strong>
            <span>{messageSummary(showPinned.body, showPinned.attachments, showPinned.deleted_at)}</span>
          </button>
          <button className={styles.pinClose} onClick={() => void t.pin(showPinned, false).catch(() => setActionError('Could not unpin the message.'))} aria-label="Unpin message"><X size={14} aria-hidden /></button>
        </div>
      )}

      {activeCall && !groupBusy && (
        <div className={styles.groupCallBar} role="status">
          <span className={styles.liveDot} aria-hidden />
          <span><strong>{title}</strong> has a {activeCall.kind} call in progress.</span>
          <Button variant="dark" onClick={() => startOrJoinGroup(activeCall.kind)}>Join call</Button>
        </div>
      )}

      {view === 'media' ? <MediaGallery cid={cid} /> : (
        <>
          <div
            className={styles.scroll} ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            {t.hasOlder && (
              <button className={styles.older} onClick={() => { stick.current = false; void t.loadOlder(); }} disabled={t.loadingOlder}>
                {t.loadingOlder ? 'Loading older messages…' : 'Load older messages'}
              </button>
            )}
            {t.isLoading && <MessageListSkeleton />}
            {t.isError && <p className={styles.note} role="alert">Could not load messages. <button onClick={() => t.refetch()}>Retry</button></p>}
            {!t.isLoading && !t.isError && count === 0 && (
              <EmptyState variant="chat" title="Say hello" compact>
                This is the beginning of your conversation with {isGroup ? 'the group' : title}. Messages arrive here in real time.
              </EmptyState>
            )}
            {jumpError && <p className={styles.jumpError} role="alert">{jumpError}</p>}
            {actionError && <p className={styles.jumpError} role="alert">{actionError} <button onClick={() => setActionError(null)}>Dismiss</button></p>}

            <ul className={styles.msgs} aria-label="Messages">
              {(() => {
                let lastDay = '';
                return t.messages.map((m) => {
                  const day = dayKey(m.created_at);
                  const separator = day !== lastDay;
                  lastDay = day;
                  const mine = m.sender_id === uid;
                  const sender = memberMap.get(m.sender_id);
                  const readCount = readCountMap.get(m.id);
                  return (
                    <Fragment key={m.id}>
                      {separator && <li className={styles.day}><span>{formatDay(m.created_at)}</span></li>}
                      <MessageBubble
                        message={m}
                        uid={uid}
                        mine={mine}
                        senderName={sender?.display_name ?? nameOf(m.sender_id)}
                        senderAvatar={sender?.avatar_path}
                        isGroup={isGroup}
                        mentions={mentionNames}
                        readLabel={!isGroup && mine && m.id === lastMineId && !m.status ? (seen(m) ? 'Seen' : 'Sent') : null}
                        readCount={mine && !m.status ? readCount : undefined}
                        starred={!!m.message_stars?.length}
                        pinned={pinnedIds.has(m.id)}
                        highlighted={highlight === m.id}
                        onOpenActions={setActionMessage}
                        onRetry={(msg) => { stick.current = true; void t.send(msg.body, msg.id, msg.attachments ?? [], msg.reply_to ?? null, msg.forwarded); }}
                        onReaction={react}
                        resolveName={nameOf}
                      />
                    </Fragment>
                  );
                });
              })()}
            </ul>
            {t.messages.length > 0 && <p className={styles.endNote}>Messages stay in this conversation. Search or use chat settings to manage your copy.</p>}
          </div>
          <Composer
            cid={cid}
            uid={uid}
            replyTo={reply ? toReply(reply) : null}
            replyName={reply ? nameOf(reply.sender_id) : undefined}
            onCancelReply={() => setReply(null)}
            onSend={async (body, id, atts, replyTo) => {
              stick.current = true;
              await t.send(body, id, atts, replyTo);
              if (replyTo) setReply(null);
            }}
            members={isGroup
              ? (members.data ?? []).map((m) => ({ username: m.username, display_name: m.display_name }))
              : conv.peer_username ? [{ username: conv.peer_username, display_name: conv.peer_display_name ?? conv.peer_username }] : []}
            enterToSend={profile.data?.enter_to_send ?? true}
            onTyping={typing.notifyTyping}
            onTypingStop={typing.stopTyping}
          />
        </>
      )}

      {actionMessage && (
        <MessageActions
          open
          message={actionMessage}
          mine={actionMessage.sender_id === uid}
          isPinned={pinnedIds.has(actionMessage.id)}
          isStarred={!!actionMessage.message_stars?.length}
          onClose={() => setActionMessage(null)}
          onReply={(m) => { setReply(m); setView('chat'); stick.current = true; }}
          onReact={(m, emoji) => react(m, emoji, !(m.message_reactions ?? []).some((r) => r.user_id === uid && r.emoji === emoji))}
          onForward={setForwarding}
          onEdit={(m) => setEditing({ m, text: m.body })}
          onPin={(m) => { void t.pin(m, !pinnedIds.has(m.id)).catch(() => setActionError('Could not update the pin.')); }}
          onStar={(m) => { void t.star(m, !m.message_stars?.length).catch(() => setActionError('Could not update saved messages.')); }}
          onDeleteForMe={(m) => { void t.hideForMe(m).catch(() => setActionError('Could not remove the message for you.')); }}
          onDeleteForEveryone={setDeleteTarget}
          onReport={setReporting}
        />
      )}

      <Dialog
        open={!!editing} onClose={() => setEditing(null)} title="Edit message" size="sm"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={!editing?.text.trim() || editing.text.trim() === editing.m.body}>Save changes</Button></>}
      >
        <label className={styles.editLabel} htmlFor="edit-message">Message text</label>
        <textarea id="edit-message" className={styles.editArea} rows={4} maxLength={4000} value={editing?.text ?? ''}
          onChange={(e) => setEditing((cur) => (cur ? { ...cur, text: e.target.value } : cur))} autoFocus />
        <p className={styles.editHint}>Edited messages are marked as edited for everyone.</p>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={deleteForEveryone}
        loading={deleting} destructive title="Delete this message for everyone?" confirmLabel="Delete for everyone"
      >
        The message text and its attachments will be removed for every member. This cannot be undone.
      </ConfirmDialog>

      <ForwardDialog open={!!forwarding} message={forwarding} onClose={() => setForwarding(null)} />
      {reporting && <ReportDialog open messageId={reporting.id} name={nameOf(reporting.sender_id)} onClose={() => setReporting(null)} />}
      <ProfileDialog userId={profileOpen ? conv.peer_id : null} onClose={() => setProfileOpen(false)} />
      {isGroup && infoOpen && <GroupInfoDialog onClose={() => setInfoOpen(false)} conv={conv} uid={uid} />}
      {menuOpen && (
        <ConversationMenu
          onClose={() => setMenuOpen(false)} conv={conv} uid={uid}
          onOpenMedia={() => setView('media')}
          onOpenSearch={() => { setSearchOpen(true); setView('chat'); }}
        />
      )}

    </div>
  );
}
