import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole, MessageCircle, Phone } from 'lucide-react';
import { Logo } from '@/components/Logo/Logo';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import styles from './Auth.module.css';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className={`grid-surface ${styles.page}`}>
      <aside className={styles.aside} aria-label="About ChatSpace">
        <Link to="/" className={styles.asideBrand}>
          <Logo size={32} tone="dark" />
          ChatSpace
        </Link>
        <div className={styles.asideCopy}>
          <p className={styles.eyebrow}><span className={styles.dot} aria-hidden /> One place for every conversation</p>
          <p className={styles.asideTitle}>Close by,<br />wherever you are.</p>
          <p className={styles.asideText}>Private chats, lively groups, voice notes and calls — all in a calm, installable web app.</p>
          <ul className={styles.asideList}>
            <li><LockKeyhole size={16} aria-hidden /> Private media and member-checked access</li>
            <li><MessageCircle size={16} aria-hidden /> Real-time messages, reactions and replies</li>
            <li><Phone size={16} aria-hidden /> Voice and video calls when text is not enough</li>
          </ul>
        </div>
        <p className={styles.asideFoot}>No app store. Install straight from your browser.</p>
      </aside>

      <div className={styles.cardCol}>
        <div className={styles.cardTop}>
          <Link to="/" className={styles.mobileBrand}>
            <Logo size={26} />
            ChatSpace
          </Link>
          <ThemeToggle />
        </div>
        <div className={styles.card}>
          <div className={styles.heading}>
            <h1 className={styles.title}>{title}</h1>
            {subtitle && <p className={styles.sub}>{subtitle}</p>}
          </div>
          {children}
          {footer && <p className={styles.footer}>{footer}</p>}
          <p className={styles.small}><Link to="/">Back to home</Link></p>
        </div>
      </div>
    </main>
  );
}
