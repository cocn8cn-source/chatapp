import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Accessibility, Keyboard } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle/ThemeToggle';
import { Switch } from '@/components/Switch/Switch';
import { Button } from '@/components/Button/Button';
import { keys, updateMySettings, type MyProfile } from '@/features/chat/api';
import { Panel, Status } from './SettingsUi';
import styles from './Settings.module.css';

export function AppearanceSettings({ me }: { me: MyProfile }) {
  const qc = useQueryClient();
  const [reduced, setReduced] = useState(me.reduced_motion);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  }, [reduced]);

  const save = useMutation({
    mutationFn: () => updateMySettings({ reduced_motion: reduced }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Accessibility preference saved.' });
      void qc.invalidateQueries({ queryKey: keys.myProfile });
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  return (
    <>
      <Panel id="appearance" title="Appearance" description="Theme changes apply immediately and are remembered on this device.">
        <ThemeToggle />
        <p className={styles.hint}>Light is ChatSpace’s warm paper theme. Dark uses deep charcoal surfaces with the same accents and contrast targets. “System” follows your operating system preference.</p>
      </Panel>

      <Panel id="accessibility" title="Accessibility" description="Reduce motion and use predictable keyboard controls.">
        <Switch
          label="Reduce motion" checked={reduced}
          onChange={setReduced}
          description="Minimises transitions and decorative animation while preserving state changes."
        />
        {msg && <Status ok={msg.ok}>{msg.text}</Status>}
        <div className={styles.actions}>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={reduced === me.reduced_motion}>Save accessibility preference</Button>
        </div>
        <div className={styles.privacyNote}>
          <Accessibility size={16} aria-hidden />
          <p>All interactive controls have visible focus rings, labels and keyboard access. The app also respects your operating-system reduced-motion setting even when this preference is off.</p>
        </div>
      </Panel>

      <Panel id="shortcuts" title="Keyboard shortcuts" description="Desktop conveniences. Mobile devices use the same visible controls.">
        <div className={styles.subhead}><Keyboard size={16} aria-hidden /> Conversations</div>
        <ul className={styles.shortcuts}>
          <li><span>Send message</span><span><kbd>Enter</kbd></span></li>
          <li><span>New line</span><span><kbd>Shift</kbd> + <kbd>Enter</kbd></span></li>
          <li><span>Cancel reply or close menu</span><span><kbd>Esc</kbd></span></li>
          <li><span>Send when Enter-to-send is off</span><span><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></span></li>
        </ul>
        <p className={styles.hint}>Dialogs trap focus and return it to the control that opened them. Tab moves through controls; shift-tab moves back.</p>
      </Panel>
    </>
  );
}
