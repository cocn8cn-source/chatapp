import { useMemo } from 'react';
import { tokenizeMessage } from './links';
import styles from './MessageBubble.module.css';

export function MessageBody({ text, mentions = [] }: { text: string; mentions?: string[] }) {
  const segments = useMemo(() => tokenizeMessage(text, mentions), [text, mentions]);
  return (
    <p className={styles.body}>
      {segments.map((seg, i) => {
        if (seg.type === 'url') {
          return (
            <a key={i} href={seg.value} target="_blank" rel="noopener noreferrer nofollow ugc" className={styles.link}>
              {seg.value}
            </a>
          );
        }
        if (seg.type === 'mention') return <span key={i} className={styles.mention}>{seg.value}</span>;
        return <span key={i}>{seg.value}</span>;
      })}
    </p>
  );
}
