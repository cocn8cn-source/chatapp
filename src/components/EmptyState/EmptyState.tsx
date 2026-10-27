import type { ReactNode } from 'react';
import { Illustration } from './Illustration';
import styles from './EmptyState.module.css';

type Props = {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  variant?: 'chat' | 'contacts' | 'search' | 'lock' | 'call' | 'offline' | 'saved';
  compact?: boolean;
};

export function EmptyState({ title, children, action, variant = 'chat', compact }: Props) {
  return (
    <div className={`${styles.empty} ${compact ? styles.compact : ''}`}>
      <Illustration variant={variant} size={compact ? 100 : 148} />
      <div className={styles.copy}>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
