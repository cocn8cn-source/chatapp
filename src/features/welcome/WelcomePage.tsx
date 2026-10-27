import { Link } from 'react-router-dom';
import { LockKeyhole, MessageCircle, Phone, Sparkles, WifiOff } from 'lucide-react';
import { envResult } from '@/config/env';
import { Button } from '@/components/Button/Button';
import { Logo } from '@/components/Logo/Logo';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import styles from './WelcomePage.module.css';

export function WelcomePage() {
  return (
    <main className={`grid-surface grid-surface--large ${styles.page}`}>
      <header className={styles.top}>
        <span className={styles.brand}>
          <Logo size={32} />
          ChatSpace
        </span>
        <div className={styles.topTools}>
          <span className={styles.installChip}><Sparkles size={14} aria-hidden /> Installable web app</span>
          <ThemeToggle />
        </div>
      </header>

      <section className={styles.hero} aria-labelledby="welcome-title">
        <div className={styles.copy}>
          <p className={styles.eyebrow}><span className={styles.dot} aria-hidden /> Real-time messaging, no app store</p>
          <h1 id="welcome-title" className={styles.title}>
            Say it now.<br />
            Hear back <span className={styles.highlight}>now.</span>
          </h1>
          <p className={styles.lede}>
            Private chats, group conversations, voice notes and calls in one calm place — installable from your browser
            and ready on every screen.
          </p>
          <div className={styles.actions}>
            <Link to="/register" className={styles.cta}><Button tabIndex={-1}>Create account</Button></Link>
            <Link to="/login" className={styles.cta}><Button variant="secondary" tabIndex={-1}>Sign in</Button></Link>
          </div>
          <p className={styles.note}>Free to start. Works on desktop, tablet and mobile.</p>
          {!envResult.ok && (
            <p className={styles.config} role="alert">
              Supabase is not configured. Set {envResult.missing.join(', ')} in <code>.env</code> (see <code>.env.example</code>).
            </p>
          )}

          <ul className={styles.points}>
            <li><LockKeyhole size={16} aria-hidden /><span><strong>Private by default</strong>Signed media and member-checked access.</span></li>
            <li><Phone size={16} aria-hidden /><span><strong>Talk or type</strong>Voice notes and calls when text is not enough.</span></li>
            <li><WifiOff size={16} aria-hidden /><span><strong>At home on your screen</strong>Install it once, open it like an app.</span></li>
          </ul>
        </div>

        <div className={styles.visual} aria-hidden>
          <span className={styles.stamp}>hello<br />again</span>
          <span className={styles.spark} />

          <div className={styles.phone}>
            <div className={styles.phoneTop}>
              <span className={styles.phoneAvatar}>M</span>
              <span className={styles.phoneWho}><strong>Mira</strong><small><span className={styles.online} />online now</small></span>
              <MessageCircle size={18} />
              <Phone size={17} />
            </div>

            <div className={styles.chat}>
              <p className={`${styles.bubble} ${styles.bubbleIn}`}>Are we still on for tonight?</p>
              <p className={`${styles.bubble} ${styles.bubbleOut}`}>Yes — call you at eight? <span className={styles.time}>20:12 ✓✓</span></p>
              <div className={`${styles.bubble} ${styles.voiceBubble}`}>
                <span className={styles.play}><span className={styles.playTriangle} /></span>
                <span className={styles.wave} aria-hidden>
                  {[5, 9, 14, 8, 16, 11, 6, 12, 15, 7, 10, 5].map((h, i) => (
                    <span key={i} style={{ height: `${h}px` }} />
                  ))}
                </span>
                <small>0:14</small>
                <span className={styles.micDot} />
              </div>
              <p className={`${styles.bubble} ${styles.bubbleIn}`}>Perfect. Bring the playlist.</p>
            </div>

            <span className={styles.floatBadge} aria-hidden>3 new</span>
            <div className={styles.phoneComposer}>
              <span className={styles.plus}>+</span>
              <span className={styles.fakeInput}>Message Mira…</span>
              <span className={styles.send}>→</span>
            </div>
          </div>

          <span className={styles.floatCard}><span className={styles.floatIcon}><Phone size={14} /></span><span><strong>Voice call</strong><small>Connecting…</small></span></span>
        </div>
      </section>

      <footer className={styles.bottom}>
        <p>ChatSpace is a progressive web app — no store download, no separate account.</p>
        <Link to="/register" className={styles.bottomLink}>Get started <span aria-hidden>→</span></Link>
      </footer>
    </main>
  );
}
