import styles from './Skeleton.module.css';

export function Skeleton({ width = '100%', height = '1rem', radius = 'var(--r-sm)', className }: {
  width?: string; height?: string; radius?: string; className?: string;
}) {
  return <span className={`${styles.bar} ${className ?? ''}`} style={{ width, height, borderRadius: radius }} aria-hidden />;
}

export function ConversationListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className={styles.list} role="status" aria-label="Loading conversations">
      {Array.from({ length: rows }, (_, i) => (
        <div className={styles.row} key={i}>
          <span className={styles.avatar} />
          <span className={styles.lines}>
            <Skeleton width={`${45 + ((i * 13) % 30)}%`} height="0.8rem" />
            <Skeleton width={`${65 + ((i * 7) % 25)}%`} height="0.7rem" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function MessageListSkeleton() {
  return (
    <div className={styles.messages} role="status" aria-label="Loading messages">
      {[62, 44, 72, 38, 55].map((w, i) => (
        <span key={i} className={i % 2 ? styles.theirs : styles.mine} style={{ width: `${w}%` }}>
          <Skeleton height={`${2 + (i % 3)}rem`} radius="var(--r-lg)" />
        </span>
      ))}
    </div>
  );
}
