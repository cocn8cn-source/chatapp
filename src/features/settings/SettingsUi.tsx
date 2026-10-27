import type { ReactNode } from 'react';
import styles from './Settings.module.css';

export function Panel({ title, description, children, actions, id }: {
  title: string; description?: string; children: ReactNode; actions?: ReactNode; id?: string;
}) {
  return (
    <section className={styles.panel} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className={styles.panelHead}>
        <div>
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className={styles.panelActions}>{actions}</div>}
      </header>
      <div className={styles.panelBody}>{children}</div>
    </section>
  );
}

export function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowCopy}>
        <strong>{label}</strong>
        {description && <span>{description}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

export function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <p className={ok ? styles.ok : styles.err} role={ok ? 'status' : 'alert'}>{children}</p>;
}
