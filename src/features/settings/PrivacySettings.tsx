import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { SelectField } from '@/components/SelectField/SelectField';
import { Switch } from '@/components/Switch/Switch';
import {
  fetchBlockedPeople, keys, unblockUser, updateMyProfile, updateMySettings, type MyProfile, type Visibility,
} from '@/features/chat/api';
import { Panel, Status } from './SettingsUi';
import styles from './Settings.module.css';

const VISIBILITY = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'contacts', label: 'Contacts and shared chats' },
  { value: 'nobody', label: 'Nobody' },
];
const MESSAGE_POLICY = [
  { value: 'everyone', label: 'Anyone with my username' },
  { value: 'contacts', label: 'Only my contacts' },
];

type Draft = {
  avatar_visibility: Visibility; about_visibility: Visibility;
  online_visibility: Visibility; last_seen_visibility: Visibility;
  read_receipts: boolean; who_can_message: 'everyone' | 'contacts';
};

export function PrivacySettings({ me }: { me: MyProfile }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({
    avatar_visibility: me.avatar_visibility ?? 'everyone',
    about_visibility: me.about_visibility ?? 'everyone',
    online_visibility: me.online_visibility ?? 'everyone',
    last_seen_visibility: me.last_seen_visibility ?? 'everyone',
    read_receipts: me.read_receipts,
    who_can_message: me.who_can_message,
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const blocked = useQuery({ queryKey: keys.blocked, queryFn: fetchBlockedPeople });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.myProfile });
    void qc.invalidateQueries({ queryKey: keys.conversations });
    void qc.invalidateQueries({ queryKey: keys.contacts });
    void qc.invalidateQueries({ queryKey: ['profile-card'] });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      await updateMyProfile({
        avatar_visibility: draft.avatar_visibility, about_visibility: draft.about_visibility,
        online_visibility: draft.online_visibility, last_seen_visibility: draft.last_seen_visibility,
      });
      await updateMySettings({ read_receipts: draft.read_receipts, who_can_message: draft.who_can_message });
    },
    onSuccess: () => { setMsg({ ok: true, text: 'Privacy settings saved.' }); refresh(); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  const unblock = useMutation({
    mutationFn: unblockUser,
    onSuccess: () => { void blocked.refetch(); refresh(); },
    onError: (e) => setMsg({ ok: false, text: (e as Error).message }),
  });

  const dirty = draft.avatar_visibility !== (me.avatar_visibility ?? 'everyone')
    || draft.about_visibility !== (me.about_visibility ?? 'everyone')
    || draft.online_visibility !== (me.online_visibility ?? 'everyone')
    || draft.last_seen_visibility !== (me.last_seen_visibility ?? 'everyone')
    || draft.read_receipts !== me.read_receipts
    || draft.who_can_message !== me.who_can_message;

  return (
    <>
      <Panel id="privacy" title="Privacy" description="These rules are enforced by database policies and private storage, not just hidden in the interface.">
        <div className={styles.grid2}>
          <SelectField label="Profile photo" options={VISIBILITY} value={draft.avatar_visibility}
            onChange={(e) => setDraft({ ...draft, avatar_visibility: e.target.value as Visibility })}
            hint="Photos use short-lived signed URLs." />
          <SelectField label="About / status" options={VISIBILITY} value={draft.about_visibility}
            onChange={(e) => setDraft({ ...draft, about_visibility: e.target.value as Visibility })} />
          <SelectField label="Online status" options={VISIBILITY} value={draft.online_visibility}
            onChange={(e) => setDraft({ ...draft, online_visibility: e.target.value as Visibility })} />
          <SelectField label="Last seen" options={VISIBILITY} value={draft.last_seen_visibility}
            onChange={(e) => setDraft({ ...draft, last_seen_visibility: e.target.value as Visibility })} />
          <SelectField label="Who can start a new chat with me" options={MESSAGE_POLICY} value={draft.who_can_message}
            onChange={(e) => setDraft({ ...draft, who_can_message: e.target.value as Draft['who_can_message'] })}
            hint="Existing conversations are not blocked by this setting." />
        </div>
        <Switch
          label="Send read receipts" checked={draft.read_receipts}
          onChange={(read_receipts) => setDraft({ ...draft, read_receipts })}
          description="When off, other people won’t see when you read or received their messages. Unread counts still work for you."
        />
        <div className={styles.privacyNote}>
          <ShieldCheck size={16} aria-hidden />
          <p>Privacy is checked server-side. Photos remain available through already-issued signed URLs for up to a few minutes after a change.</p>
        </div>
        {msg && <Status ok={msg.ok}>{msg.text}</Status>}
        <div className={styles.actions}><Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>Save privacy settings</Button></div>
      </Panel>

      <Panel id="blocked" title="Blocked people" description="Blocked people cannot send direct messages or start calls with you.">
        {blocked.isLoading && <p className={styles.hint} role="status">Loading…</p>}
        {blocked.isError && <Status ok={false}>Could not load blocked users.</Status>}
        {blocked.isSuccess && blocked.data.length === 0 && <p className={styles.hint}>You haven’t blocked anyone. Manage contacts in <Link to="/app/contacts">People</Link>.</p>}
        <ul className={styles.peopleList}>
          {blocked.data?.map((b) => (
            <li key={b.user_id}>
              <Link to={`/app/people/${b.user_id}`} className={styles.personLink}>
                <Avatar name={b.display_name} path={b.avatar_path} size={38} />
                <span><strong>{b.display_name}</strong><small>@{b.username}</small></span>
              </Link>
              <Button variant="secondary" onClick={() => unblock.mutate(b.user_id)} loading={unblock.isPending}>Unblock</Button>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
