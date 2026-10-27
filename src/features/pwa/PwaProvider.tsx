import { useEffect, useState, type ReactNode } from 'react';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/Button/Button';
import { usePwa } from './pwaStore';
import styles from './Pwa.module.css';

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return online;
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const initPwa = usePwa((s) => s.init);
  const online = useOnline();
  const [offlineReady, setOfflineReady] = useState(false);
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      window.setInterval(() => { void registration.update(); }, 60 * 60_000);
    },
    onRegisterError(error) { console.warn('[ChatSpace] Service worker registration failed', error?.message ?? error); },
  });

  useEffect(() => initPwa(), [initPwa]);
  useEffect(() => {
    if (!offlineReady) return;
    const t = window.setTimeout(() => setOfflineReady(false), 5000);
    return () => window.clearTimeout(t);
  }, [offlineReady, setOfflineReady]);

  return (
    <>
      {children}
      {!online && (
        <div className={styles.offline} role="status" aria-live="polite">
          <WifiOff size={16} aria-hidden />
          <span>You’re offline. Messages will need to be retried when the connection returns.</span>
        </div>
      )}
      {needRefresh && (
        <div className={styles.update} role="status">
          <RefreshCw size={18} aria-hidden />
          <div>
            <strong>A new version is ready</strong>
            <span>Reload to finish updating. Drafts are kept on this device.</span>
          </div>
          <Button onClick={() => void updateServiceWorker(true)}>Reload</Button>
          <button className={styles.dismiss} onClick={() => setNeedRefresh(false)} aria-label="Dismiss update"><X size={16} aria-hidden /></button>
        </div>
      )}
      {offlineReady && (
        <div className={styles.ready} role="status">
          <Download size={16} aria-hidden />
          <span>ChatSpace is ready to open offline. Private messages are never cached in the shared service-worker cache.</span>
          <button className={styles.dismiss} onClick={() => setOfflineReady(false)} aria-label="Dismiss"><X size={16} aria-hidden /></button>
        </div>
      )}
    </>
  );
}
