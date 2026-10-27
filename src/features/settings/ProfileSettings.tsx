import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import { Avatar } from '@/components/Avatar/Avatar';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import { supabase } from '@/lib/supabase';
import { AVATAR_TYPES, MAX_AVATAR_BYTES, profileSchema } from '@/features/auth/schemas';
import { keys, updateMyProfile, type MyProfile } from '@/features/chat/api';
import { AvatarCropper } from '@/features/profile/AvatarCropper';
import { Panel, Status } from './SettingsUi';
import styles from './Settings.module.css';

type Values = z.infer<typeof profileSchema>;

export function ProfileSettings({ me }: { me: MyProfile }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<Values>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName: me.display_name, username: me.username, about: me.about },
  });

  useEffect(() => {
    reset({ displayName: me.display_name, username: me.username, about: me.about });
  }, [me.display_name, me.username, me.about, reset]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.myProfile });
    void qc.invalidateQueries({ queryKey: keys.conversations });
    void qc.invalidateQueries({ queryKey: ['profile-card'] });
  };

  const onSubmit = async (v: Values) => {
    setMessage(null);
    try {
      await updateMyProfile({ display_name: v.displayName, username: v.username.toLowerCase(), about: v.about });
      setMessage({ ok: true, text: 'Profile saved.' });
      refresh();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === '23505') setError('username', { message: 'That username is taken' });
      else setMessage({ ok: false, text: err.message ?? 'Could not save your profile.' });
    }
  };

  const pickFile = (file: File | null) => {
    setMessage(null);
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) return setMessage({ ok: false, text: 'Use a JPEG, PNG or WebP image.' });
    if (file.size > MAX_AVATAR_BYTES) return setMessage({ ok: false, text: 'The image must be under 2 MB.' });
    setCropFile(file);
  };

  const uploadAvatar = async (file: File) => {
    setCropFile(null);
    if (!supabase) return;
    setAvatarBusy(true);
    const uid = me.id;
    const path = `${uid}/avatar-${Date.now()}.webp`;
    try {
      const up = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      await updateMyProfile({ avatar_path: path });
      const old = me.avatar_path;
      if (old && old !== path) await supabase.storage.from('avatars').remove([old]).catch(() => {});
      setMessage({ ok: true, text: 'Photo updated.' });
      refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message || 'Photo upload failed.' });
    } finally { setAvatarBusy(false); }
  };

  const removeAvatar = async () => {
    if (!me.avatar_path || !supabase) return;
    setAvatarBusy(true);
    try {
      await updateMyProfile({ avatar_path: null });
      await supabase.storage.from('avatars').remove([me.avatar_path]).catch(() => {});
      setMessage({ ok: true, text: 'Photo removed.' });
      refresh();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message || 'Could not remove the photo.' });
    } finally { setAvatarBusy(false); }
  };

  return (
    <Panel id="profile" title="Profile" description="How you appear in conversations and contact discovery.">
      <div className={styles.avatarRow}>
        <Avatar name={me.display_name} path={me.avatar_path} size={84} />
        <div className={styles.avatarActions}>
          <div className={styles.inlineButtons}>
            <Button variant="secondary" onClick={() => fileInput.current?.click()} loading={avatarBusy}>
              <Camera size={16} aria-hidden /> {me.avatar_path ? 'Change photo' : 'Add photo'}
            </Button>
            {me.avatar_path && (
              <Button variant="ghost" onClick={() => void removeAvatar()} disabled={avatarBusy}>
                <Trash2 size={15} aria-hidden /> Remove
              </Button>
            )}
          </div>
          <p className={styles.hint}>JPEG, PNG or WebP under 2 MB. You’ll crop it into a square before upload.</p>
          <input ref={fileInput} type="file" accept={AVATAR_TYPES.join(',')} hidden
            onChange={(e) => { pickFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        </div>
      </div>

      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className={styles.fieldPair}>
          <TextField label="Name" autoComplete="name" error={errors.displayName?.message} {...register('displayName')} />
          <TextField label="Username" autoComplete="username" autoCapitalize="none" hint="People find you by this" error={errors.username?.message} {...register('username')} />
        </div>
        <TextField label="About" hint={`${me.about.length}/140 characters currently. Keep it short and useful.`} error={errors.about?.message} {...register('about')} />
        {message && <Status ok={message.ok}>{message.text}</Status>}
        <div className={styles.actions}><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save profile</Button></div>
      </form>

      <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onDone={(f) => void uploadAvatar(f)} />
    </Panel>
  );
}
