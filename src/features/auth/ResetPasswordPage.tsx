import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import { AuthLayout } from './AuthLayout';
import { authErrorMessage } from './authErrors';
import { newPasswordSchema } from './schemas';
import styles from './Auth.module.css';

type Values = z.infer<typeof newPasswordSchema>;

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { session, ready } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(newPasswordSchema) });

  const onSubmit = async ({ password }: Values) => {
    setFormError(null);
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return setFormError(authErrorMessage(error));
    navigate('/app/chats', { replace: true });
  };

  if (!ready) return <AuthLayout title="Checking your link…"><p className={styles.sub} role="status">One moment.</p></AuthLayout>;
  if (!session) {
    return (
      <AuthLayout title="This link has expired" subtitle="Reset links work once and expire quickly." footer={<Link to="/forgot-password">Request a new link</Link>}>{null}</AuthLayout>
    );
  }
  return (
    <AuthLayout title="Choose a new password">
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField label="New password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
        {formError && <p className={styles.formError} role="alert">{formError}</p>}
        <Button type="submit" loading={isSubmitting}>Save password</Button>
      </form>
    </AuthLayout>
  );
}
