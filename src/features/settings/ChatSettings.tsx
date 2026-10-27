import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive } from 'lucide-react';
import { Switch } from '@/components/Switch/Switch';
import { Button } from '@/components/Button/Button';
import { fetchStorageUsage, keys, updateMySettings, type MyProfile } from '@/features/chat/api';
import { formatBytes } from '@/features/chat/media/validation';
import { Panel, Status } from './SettingsUi';
import styles from './Settings.module.css';

type Draft = Pick<MyProfile, 'auto_download_images' | 'auto_download_videos' | 'enter_to_send'>;

export function ChatSettings({ me }: { me: MyProfile }) {
  const qc = useQueryClient();
  const usage = useQuery({ queryKey: keys.usage, queryFn: fetchStorageUsage });
  const [draft, setDraft] = useState<Draft>({
    auto_download_images: me.auto_download_images,
    auto_download_videos: me.auto_download_videos,
    enter_to_send: me.enter_to_send,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = useMutation({
    mutationFn: () => updateMySettings(draft),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Chat preferences saved.' });
      void qc.invalidateQueries({ queryKey: keys.myProfile });
    },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  const dirty = draft.auto_download_images !== me.auto_download_images
    || draft.auto_download_videos !== me.auto_download_videos
    || draft.enter_to_send !== me.enter_to_send;

  return (
    <>
      <Panel id="chats" title="Chats and media" description="Control how messages are sent and when private media is fetched.">
        <Switch
          label="Press Enter to send" checked={draft.enter_to_send}
          onChange={(enter_to_send) => setDraft({ ...draft, enter_to_send })}
          description="When off, Enter adds a new line and Ctrl/⌘ + Enter sends."
        />
        <Switch
          label="Automatically load images" checked={draft.auto_download_images}
          onChange={(auto_download_images) => setDraft({ ...draft, auto_download_images })}
          description="Images use short-lived signed links. When off, tap each image to load it."
        />
        <Switch
          label="Automatically load videos" checked={draft.auto_download_videos}
          onChange={(auto_download_videos) => setDraft({ ...draft, auto_download_videos })}
          description="When off, video attachments wait for you to load them. Playback still requires a tap."
        />
        {msg && <Status ok={msg.ok}>{msg.text}</Status>}
        <div className={styles.actions}>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Save chat preferences</Button>
        </div>
      </Panel>

      <Panel id="storage" title="Media storage" description="Your uploads count toward a 500 MB per-account allowance.">
        <div className={styles.installHero}>
          <strong>{usage.isSuccess ? formatBytes(usage.data) : usage.isError ? 'Unavailable' : 'Loading…'} used</strong>
          <p>
            {usage.isSuccess
              ? `of 500 MB. Individual files are limited to 25 MB. Shared files remain available while the conversation and message exist.`
              : usage.isError
                ? 'Storage usage could not be read. Confirm that migration 0003 is applied and you are signed in.'
                : 'Checking attachments you have uploaded…'}
          </p>
          {usage.isSuccess && (
            <div aria-hidden style={{ height: 8, borderRadius: 999, background: 'var(--surface)', overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${Math.min(100, (usage.data / 524288000) * 100)}%`, height: '100%', background: usage.data > 450 * 1024 * 1024 ? 'var(--error)' : 'var(--accent)' }} />
            </div>
          )}
        </div>
        <div className={styles.privacyNote}>
          <HardDrive size={16} aria-hidden />
          <p>Media is stored in a private bucket. Access is checked server-side for every signed link, and deleted messages stop serving their files. Clearing a chat for yourself does not delete files that other members still have.</p>
        </div>
      </Panel>
    </>
  );
}
