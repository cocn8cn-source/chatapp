import { useState } from 'react';
import { Download, Smartphone, WifiOff } from 'lucide-react';
import { Button } from '@/components/Button/Button';
import { usePwa } from '@/features/pwa/pwaStore';
import { Panel } from './SettingsUi';
import styles from './Settings.module.css';

export function InstallSettings() {
  const { canInstall, installed, iosGuidance, promptInstall } = usePwa();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const result = await promptInstall();
      if (result === 'accepted') setMsg('ChatSpace was installed. Launch it from your Home Screen or app list.');
      else if (result === 'dismissed') setMsg('Installation was dismissed. You can use the browser version any time.');
      else setMsg('This browser has not offered an install prompt. Follow the manual steps below.');
    } finally { setBusy(false); }
  };

  return (
    <>
      <Panel id="install" title="Install ChatSpace" description="Installation creates a web app experience — not a native App Store or Play Store app.">
        <div className={styles.installHero}>
          <strong>{installed ? 'ChatSpace is running as an installed app' : canInstall ? 'Ready to install on this device' : 'Use ChatSpace from your browser'}</strong>
          <p>
            {installed
              ? 'You are in standalone mode. Browser and operating-system support still determine notifications, camera, microphone and background behaviour.'
              : canInstall
                ? 'Your browser supports installation. The app opens in its own window and can be launched from your device.'
                : 'This browser has not exposed an install prompt. Use the browser menu or the platform instructions below.'}
          </p>
          {canInstall && !installed && (
            <div className={styles.actions}>
              <Button onClick={() => void install()} loading={busy}><Download size={16} aria-hidden /> Install ChatSpace</Button>
            </div>
          )}
          {msg && <p className={styles.ok} role="status">{msg}</p>}
        </div>

        <div className={styles.divider} />
        <div className={styles.subhead}><Smartphone size={16} aria-hidden /> Install on Android</div>
        <ol className={styles.steps}>
          <li>Open ChatSpace in Chrome, Edge or another supported Android browser over HTTPS.</li>
          <li>Open the browser menu, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
          <li>Confirm. Launch ChatSpace from the new Home Screen icon.</li>
        </ol>

        <div className={styles.divider} />
        <div className={styles.subhead}><Smartphone size={16} aria-hidden /> Install on iPhone or iPad</div>
        <ol className={styles.steps}>
          <li>Open ChatSpace in Safari. Web push requires the installed Home Screen app, not a normal tab.</li>
          <li>Tap the Share button, scroll, then tap <strong>Add to Home Screen</strong>.</li>
          <li>Confirm the name and tap <strong>Add</strong>. Open ChatSpace from the Home Screen.</li>
        </ol>
        {iosGuidance && <p className={styles.hint}>This device identifies as iOS/iPadOS. Notifications still depend on the iOS version and Safari support.</p>}

        <div className={styles.divider} />
        <div className={styles.subhead}><WifiOff size={16} aria-hidden /> Updates and offline mode</div>
        <p className={styles.hint}>
          ChatSpace never silently reloads the tab. When an update is available you can choose when to reload, and drafts are kept on this device.
          The installed shell can open offline, but private messages, API responses and media are never cached in the shared service-worker cache.
          Sending and calling require a connection.
        </p>
      </Panel>
    </>
  );
}
