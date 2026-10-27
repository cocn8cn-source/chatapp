import { useState } from 'react';
import {
  Copy, CornerUpLeft, Forward, Pencil, Pin, PinOff, Star, StarOff, Trash2, UserMinus, Flag,
} from 'lucide-react';
import { Dialog } from '@/components/Dialog/Dialog';
import type { Message } from './api';
import styles from './MessageActions.module.css';

const EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🙏'];

type Props = {
  open: boolean;
  message: Message | null;
  mine: boolean;
  isPinned: boolean;
  isStarred: boolean;
  onClose: () => void;
  onReply: (m: Message) => void;
  onReact: (m: Message, emoji: string) => void;
  onForward: (m: Message) => void;
  onEdit: (m: Message) => void;
  onPin: (m: Message) => void;
  onStar: (m: Message) => void;
  onDeleteForMe: (m: Message) => void;
  onDeleteForEveryone: (m: Message) => void;
  onReport: (m: Message) => void;
};

export function MessageActions({
  open, message, mine, isPinned, isStarred, onClose, onReply, onReact, onForward,
  onEdit, onPin, onStar, onDeleteForMe, onDeleteForEveryone, onReport,
}: Props) {
  const [copied, setCopied] = useState(false);
  if (!message) return null;
  const hasText = !!message.body?.trim();

  const run = (fn: (m: Message) => void) => { fn(message); onClose(); };
  const copy = async () => {
    if (!hasText) return;
    try {
      await navigator.clipboard.writeText(message.body);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Message actions" variant="sheet" size="sm" hideTitle>
      <div className={styles.sheet}>
        <div className={styles.reactions} role="group" aria-label="React to message">
          {EMOJIS.map((emoji) => (
            <button key={emoji} type="button" className={styles.emoji} onClick={() => run(() => onReact(message, emoji))}
              aria-label={`React ${emoji}`}>
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <button onClick={() => run(onReply)}><CornerUpLeft size={18} aria-hidden /> Reply</button>
          <button onClick={() => run(onForward)} disabled={!hasText} title={!hasText ? 'Only messages with text can be forwarded' : undefined}>
            <Forward size={18} aria-hidden /> Forward
          </button>
          <button onClick={() => run(onPin)}>{isPinned ? <PinOff size={18} aria-hidden /> : <Pin size={18} aria-hidden />}{isPinned ? 'Unpin' : 'Pin'} message</button>
          <button onClick={() => run(onStar)}>{isStarred ? <StarOff size={18} aria-hidden /> : <Star size={18} aria-hidden />}{isStarred ? 'Remove from saved' : 'Save message'}</button>
          {hasText && (
            <button onClick={() => void copy()}>
              <Copy size={18} aria-hidden /> {copied ? 'Copied' : 'Copy text'}
            </button>
          )}
          {mine && hasText && <button onClick={() => run(onEdit)}><Pencil size={18} aria-hidden /> Edit</button>}
          {!mine && <button onClick={() => run(onReport)}><Flag size={18} aria-hidden /> Report message</button>}
          <button onClick={() => run(onDeleteForMe)}><UserMinus size={18} aria-hidden /> Delete for me</button>
          {mine && <button className={styles.danger} onClick={() => run(onDeleteForEveryone)}><Trash2 size={18} aria-hidden /> Delete for everyone</button>}
        </div>
        {copied && <p className={styles.note} role="status">Copied to clipboard.</p>}
      </div>
    </Dialog>
  );
}
