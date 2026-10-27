import { useMemo } from 'react';
import { CornerUpLeft, Forward, MoreHorizontal, Pin, Star } from 'lucide-react';
import { Avatar } from '@/components/Avatar/Avatar';
import { firstUrl } from './links';
import { AttachmentView } from './media/AttachmentView';
import { MessageBody } from './MessageBody';
import { LinkPreview } from './LinkPreview';
import { formatClock, messageSummary } from './format';
import type { Message, Reaction } from './api';
import styles from './MessageBubble.module.css';

type Props = {
  message: Message;
  uid: string;
  mine: boolean;
  senderName: string;
  senderAvatar?: string | null;
  isGroup: boolean;
  mentions: string[];
  readLabel?: string | null;
  readCount?: number;
  starred?: boolean;
  pinned?: boolean;
  highlighted?: boolean;
  onOpenActions: (message: Message) => void;
  onRetry?: (message: Message) => void;
  onReaction: (message: Message, emoji: string, on: boolean) => void;
  resolveName?: (userId: string) => string;
};

function groupReactions(reactions: Reaction[], uid: string) {
  const map = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const row = map.get(r.emoji) ?? { count: 0, mine: false };
    row.count += 1;
    if (r.user_id === uid) row.mine = true;
    map.set(r.emoji, row);
  }
  return [...map.entries()];
}

export function MessageBubble({
  message: m, uid, mine, senderName, senderAvatar, isGroup, mentions, readLabel, readCount,
  starred, pinned, highlighted, onOpenActions, onRetry, onReaction, resolveName,
}: Props) {
  const grouped = useMemo(() => groupReactions(m.message_reactions ?? [], uid), [m.message_reactions, uid]);
  const url = m.body ? firstUrl(m.body) : null;
  const deleted = !!m.deleted_at;
  const failed = m.status === 'failed';
  // A lone photo or video with no caption reads as the media itself, so it renders edge to
  // edge with the timestamp floating on top instead of sitting in an empty tinted frame.
  // Files and voice notes keep the padded bubble so their controls never touch the edge.
  const solo = m.attachments?.length === 1 ? m.attachments[0] : null;
  const mediaOnly = (solo?.kind === 'image' || solo?.kind === 'video')
    && !m.body && !m.reply_to && !m.forwarded && !deleted && !failed && m.status !== 'pending';

  return (
    <li className={`${styles.row} ${mine ? styles.mine : styles.theirs} ${highlighted ? styles.highlight : ''}`} data-message-id={m.id}>
      {!mine && isGroup && <Avatar name={senderName} path={senderAvatar} size={30} />}
      <div className={styles.stack}>
        {!mine && isGroup && <span className={styles.sender}>{senderName}</span>}
        <div className={`${styles.bubble} ${mine ? styles.out : ''} ${mediaOnly ? styles.mediaOnly : ''} ${deleted ? styles.deletedBubble : ''}`}>
          {m.forwarded && <span className={styles.flag}><Forward size={12} aria-hidden /> Forwarded</span>}
          {m.reply_to && (
            <div className={styles.reply}>
              <CornerUpLeft size={13} aria-hidden />
              <span className={styles.replyText}>
                <strong>{resolveName ? resolveName(m.reply_to.sender_id) : 'Reply'}</strong>
                {messageSummary(m.reply_to.body, m.reply_to.attachments, m.reply_to.deleted_at)}
              </span>
            </div>
          )}
          {!!m.attachments?.length && (
            <div className={styles.atts}>
              {m.attachments.map((a) => <AttachmentView key={a.storage_path} a={a} pending={m.status === 'pending'} />)}
            </div>
          )}
          {deleted
            ? <p className={styles.deleted}>Message deleted</p>
            : m.body && <MessageBody text={m.body} mentions={mentions} />}
          {!deleted && url && <LinkPreview url={url} />}
          <div className={styles.meta}>
            {pinned && <Pin size={11} aria-label="Pinned message" />}
            {starred && <Star size={11} aria-label="Saved message" fill="currentColor" />}
            {m.edited_at && !deleted && <span>edited</span>}
            <time dateTime={m.created_at}>{formatClock(m.created_at)}</time>
            {mine && m.status === 'pending' && <span>Sending</span>}
            {mine && failed && <span className={styles.failed}>Not sent</span>}
            {mine && readLabel && <span className={styles.receipt}>{readLabel}</span>}
            {mine && !readLabel && readCount ? <span className={styles.receipt}>Read by {readCount}</span> : null}
            {!deleted && (
              <button type="button" className={styles.more} onClick={() => onOpenActions(m)} aria-label="Message actions">
                <MoreHorizontal size={18} aria-hidden />
              </button>
            )}
          </div>
          {failed && onRetry && (
            <button type="button" className={styles.retry} onClick={() => onRetry(m)}>Retry send</button>
          )}
        </div>
        {!deleted && grouped.length > 0 && (
          <div className={styles.reactions} aria-label="Reactions">
            {grouped.map(([emoji, info]) => (
              <button
                key={emoji} type="button" className={`${styles.reaction} ${info.mine ? styles.reactionMine : ''}`}
                aria-pressed={info.mine} onClick={() => onReaction(m, emoji, !info.mine)}
                aria-label={`${emoji} reaction, ${info.count}. ${info.mine ? 'Remove yours' : 'Add yours'}`}
              >
                <span aria-hidden>{emoji}</span><span>{info.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
