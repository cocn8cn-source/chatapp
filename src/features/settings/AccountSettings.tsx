import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LogOut, Monitor, ShieldAlert } from 'lucide-react';
import type { z } from 'zod';
import { Button } from '@/components/Button/Button';
import { Dialog } from '@/components/Dialog/Dialog';
import { TextField } from '@/components/TextField/TextField';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/auth';
import { authErrorMessage } from '@/features/auth/authErrors';
import { changeEmailSchema, newPasswordSchema } from '@/features/auth/schemas';
import { detachPushSubscription } from '@/lib/push';
import { formatDateTime } from '@/features/chat/format';
import { Panel, Status } from './SettingsUi';
import styles from './Settings.module.css';

type EmailValues = z.infer<typeof changeEmailSchema>;
type PasswordValues = z.infer<typeof newPasswordSchema>;

export function AccountSettings({ email }: { email: string }) {
  const navigate = useNavigate();
  const session = useAuth((s) => s.session);
  const [emailMsg, setEmailMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const emailForm = useForm<EmailValues>({ resolver: zodResolver(changeEmailSchema) });
  const pwForm = useForm<PasswordValues>({ resolver: zodResolver(newPasswordSchema) });

  const changeEmail = async (v: EmailValues) => {
    setEmailMsg(null);
    if (!supabase) return;
    if (v.email.trim().toLowerCase() === email.toLowerCase()) {
      setEmailMsg({ ok: false, text: 'That is already your email address.' });
      return;
    }
    const { error } = await supabase.auth.updateUser(
      { email: v.email.trim() },
      { emailRedirectTo: `${window.location.origin}/login` },
    );
    if (error) setEmailMsg({ ok: false, text: authErrorMessage(error) });
    else {
      setEmailMsg({ ok: true, text: 'Confirmation links were sent. Check both your old and new inbox; the change completes after verification.' });
      emailForm.reset();
    }
  };

  const changePassword = async (v: PasswordValues) => {
    setPwMsg(null);
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ password: v.password });
    if (error) setPwMsg({ ok: false, text: authErrorMessage(error) });
    else { setPwMsg({ ok: true, text: 'Password changed.' }); pwForm.reset(); }
  };

  const signOutOthers = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut({ scope: 'others' });
    setSessionMsg(error ? error.message : 'Other browser sessions have been signed out.');
  };

  const signOut = async () => {
    await detachPushSubscription();
    await supabase?.auth.signOut();
    navigate('/', { replace: true });
  };

  const deleteAccount = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured');
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirm: 'DELETE' } });
      if (error) throw new Error('Account deletion could not run. The delete-account Edge Function must be deployed and the service-role secret configured.');
      if (!data?.deleted) throw new Error('The server did not confirm deletion. Nothing was deleted locally.');
      await supabase.auth.signOut().catch(() => {});
    },
    onSuccess: () => navigate('/', { replace: true }),
  });

  return (
    <>
      <Panel id="account" title="Account" description="Your sign-in identity and active sessions.">
        <div className={styles.accountGrid}>
          <div className={styles.kv}><span>Email</span><strong>{email}</strong></div>
          <div className={styles.kv}><span>Last sign-in</span><strong>{session?.user.last_sign_in_at ? formatDateTime(session.user.last_sign_in_at) : 'This session'}</strong></div>
          <div className={styles.kv}><span>This device</span><strong>{navigator.platform || 'Browser'}</strong></div>
          <div className={styles.kv}><span>Session expires</span><strong>{session?.expires_at ? formatDateTime(new Date(session.expires_at * 1000).toISOString()) : '—'}</strong></div>
        </div>

        <div className={styles.divider} />
        <h3 className={styles.subhead}>Change email</h3>
        <p className={styles.hint}>Supabase sends confirmation to the current and new address before the change is applied.</p>
        <form className={styles.form} onSubmit={emailForm.handleSubmit(changeEmail)} noValidate>
          <TextField label="New email" type="email" autoComplete="email" placeholder={email}
            error={emailForm.formState.errors.email?.message} {...emailForm.register('email')} />
          {emailMsg && <Status ok={emailMsg.ok}>{emailMsg.text}</Status>}
          <div className={styles.actions}><Button type="submit" variant="secondary" loading={emailForm.formState.isSubmitting}>Send confirmation</Button></div>
        </form>

        <div className={styles.divider} />
        <h3 className={styles.subhead}>Change password</h3>
        <form className={styles.form} onSubmit={pwForm.handleSubmit(changePassword)} noValidate>
          <TextField label="New password" type="password" autoComplete="new-password"
            hint="10+ characters with upper, lower and a number." error={pwForm.formState.errors.password?.message} {...pwForm.register('password')} />
          {pwMsg && <Status ok={pwMsg.ok}>{pwMsg.text}</Status>}
          <div className={styles.actions}><Button type="submit" variant="secondary" loading={pwForm.formState.isSubmitting}>Update password</Button></div>
        </form>

        <div className={styles.divider} />
        <h3 className={styles.subhead}>Sessions</h3>
        <div className={styles.sessionRow}>
          <span className={styles.sessionIcon}><Monitor size={18} aria-hidden /></span>
          <div><strong>This browser</strong><span>{navigator.userAgent.includes('Mobile') ? 'Mobile browser' : 'Desktop browser'} · signed in</span></div>
        </div>
        {sessionMsg && <Status ok>{sessionMsg}</Status>}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => void signOutOthers()}>Sign out other sessions</Button>
          <Button variant="ghost" onClick={() => void signOut()}><LogOut size={16} aria-hidden /> Sign out</Button>
        </div>
      </Panel>

      <Panel id="danger" title="Delete account" description="Permanently remove your profile, messages, uploads and push subscriptions.">
        <div className={styles.dangerBox}>
          <ShieldAlert size={20} aria-hidden />
          <div>
            <strong>This cannot be undone.</strong>
            <p>Messages you sent are deleted for everyone. Groups where you are the only admin are deleted or handed to another member. Media files you uploaded are removed from storage.</p>
          </div>
        </div>
        <div className={styles.actions}>
          <Button variant="danger" onClick={() => { setDeleteOpen(true); setConfirmText(''); deleteAccount.reset(); }}>Delete my account</Button>
        </div>
      </Panel>

      <Dialog
        open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete your ChatSpace account" size="sm"
        description="This removes your account and content from the server. There is no recovery period."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)} disabled={deleteAccount.isPending}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteAccount.mutate()} loading={deleteAccount.isPending} disabled={confirmText !== 'DELETE'}>
              Delete permanently
            </Button>
          </>
        }
      >
        <div className={styles.form}>
          <p className={styles.hint}>Type <strong>DELETE</strong> to confirm. If the deletion function is not deployed, nothing is deleted.</p>
          <TextField label="Confirmation" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
          {deleteAccount.isError && <Status ok={false}>{(deleteAccount.error as Error).message}</Status>}
        </div>
      </Dialog>
    </>
  );
}
