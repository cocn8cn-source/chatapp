import { useEffect, useState } from 'react';
import { Bell, BellOff, Check, Info } from 'lucide-react';
import { Button } from '@/components/Button/Button';
import { disablePush, enablePush, publicPushKey, pushStatus, pushSupported, type PushStatus } from '@/lib/push';
import styles from './EnableNotifications.module.css';

type Props = { variant?: 'settings' | 'banner'; onDismiss?: () => void };

export function EnableNotifications({ variant = 'settings', onDismiss }: Props) {
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = !!publicPushKey();

  useEffect(() => {
    void pushStatus().then(setStatus).catch(() => setStatus('unsupported'));
  }, []);

  const enable = async () => {
    setError(null); setBusy(true);
    try {
      await enablePush();
      setStatus(await pushStatus());
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const disable = async () => {
    setError(null); setBusy(true);
    try { await disablePush(); setStatus(await pushStatus()); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!pushSupported()) {
    if (variant === 'banner') return null;
    return (
      <div className={styles.info}>
        <Info size={16} aria-hidden />
        <p>
          Browser push is not available in this browser or tab. On iPhone and iPad, add ChatSpace to the Home Screen
          (Share → Add to Home Screen) and open it there. Camera, microphone and notifications still depend on device
          and browser support.
        </p>
      </div>
    );
  }

  if (!configured) {
    if (variant === 'banner') return null;
    return (
      <div className={styles.info}>
        <Info size={16} aria-hidden />
        <p>Push is not configured for this deployment. The owner needs to set <code>VITE_VAPID_PUBLIC_KEY</code> and deploy the push function. In-app notifications still work.</p>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className={styles.info}>
        <BellOff size={16} aria-hidden />
        <p>Notifications are blocked for this site. Open your browser’s site settings, allow notifications, then reload ChatSpace.</p>
      </div>
    );
  }

  if (status === 'loading') return <p className={styles.note} role="status">Checking notification support…</p>;

  if (status === 'subscribed') {
    if (variant === 'banner') return null;
    return (
      <div className={styles.status}>
        <span className={styles.ok}><Check size={16} aria-hidden /> Browser notifications are on for this device.</span>
        <Button variant="secondary" onClick={() => void disable()} loading={busy}>Turn off</Button>
        {error && <p className={styles.err} role="alert">{error}</p>}
      </div>
    );
  }

  if (variant === 'banner') {
    return (
      <div className={styles.banner}>
        <Bell size={18} aria-hidden />
        <div>
          <strong>Get notified when someone messages you</strong>
          <span>Browser notifications need your permission. You can turn them off any time.</span>
        </div>
        <Button onClick={() => void enable()} loading={busy}>Enable</Button>
        {onDismiss && <button className={styles.dismiss} onClick={onDismiss} aria-label="Dismiss notification prompt">Not now</button>}
        {error && <p className={styles.err} role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.status}>
      <p className={styles.note}>Turn on browser notifications to hear about messages and calls while ChatSpace is closed or in the background.</p>
      <Button onClick={() => void enable()} loading={busy}><Bell size={16} aria-hidden /> Enable notifications</Button>
      {error && <p className={styles.err} role="alert">{error}</p>}
    </div>
  );
}
