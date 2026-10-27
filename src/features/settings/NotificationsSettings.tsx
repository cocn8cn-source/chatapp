import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellRing, Info } from 'lucide-react';
import { Switch } from '@/components/Switch/Switch';
import { Button } from '@/components/Button/Button';
import { EnableNotifications } from '@/features/notifications/EnableNotifications';
import { keys, updateMySettings, type MyProfile } from '@/features/chat/api';
import { Panel, Status } from './SettingsUi';
import styles from './Settings.module.css';

type Draft = Pick<MyProfile, 'notify_messages' | 'notify_calls' | 'notification_sound'>;

export function NotificationsSettings({ me }: { me: MyProfile }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({
    notify_messages: me.notify_messages,
    notify_calls: me.notify_calls,
    notification_sound: me.notification_sound,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () => updateMySettings(draft),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Notification preferences saved.' });
      void qc.invalidateQueries({ queryKey: keys.myProfile });
      void qc.invalidateQueries({ queryKey: keys.notifications });
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  const dirty = draft.notify_messages !== me.notify_messages
    || draft.notify_calls !== me.notify_calls
    || draft.notification_sound !== me.notification_sound;

  return (
    <>
      <Panel id="notifications" title="Notifications" description="Choose which events notify you. In-app notifications still respect per-chat mutes and blocks.">
        <Switch
          label="Messages" checked={draft.notify_messages}
          onChange={(notify_messages) => setDraft({ ...draft, notify_messages })}
          description="New messages in conversations you have not muted."
        />
        <Switch
          label="Calls and group calls" checked={draft.notify_calls}
          onChange={(notify_calls) => setDraft({ ...draft, notify_calls })}
          description="Incoming call alerts and group call invitations."
        />
        <Switch
          label="Notification sound" checked={draft.notification_sound}
          onChange={(notification_sound) => setDraft({ ...draft, notification_sound })}
          description="Play a short sound for in-app message notifications. Browsers may block sound until you interact with the page."
        />
        {msg && <Status ok={msg.ok}>{msg.text}</Status>}
        <div className={styles.actions}>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Save notification preferences</Button>
        </div>
      </Panel>

      <Panel id="browser-notifications" title="Browser notifications" description="Push notifications can reach this device while ChatSpace is closed, when your browser and operating system allow it.">
        <EnableNotifications />
        <div className={styles.privacyNote}>
          <BellRing size={16} aria-hidden />
          <p>On iPhone and iPad, web push requires ChatSpace to be installed to the Home Screen and opened there. Browser-tab push and installed-app push can behave differently.</p>
        </div>
        <div className={styles.privacyNote}>
          <Info size={16} aria-hidden />
          <p>Muted chats, blocked people and your notification preferences are checked before a notification is created. Notification previews may show message text; lock-screen visibility is controlled by your device.</p>
        </div>
      </Panel>
    </>
  );
}
