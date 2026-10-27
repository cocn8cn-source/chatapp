import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'react-router-dom';
import type { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import { AuthLayout } from './AuthLayout';
import { authErrorMessage } from './authErrors';
import { registerSchema } from './schemas';
import styles from './Auth.module.css';

type Values = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (v: Values) => {
    setFormError(null);
    if (!supabase) return setFormError('Supabase is not configured.');
    const username = v.username.toLowerCase();
    const avail = await supabase.rpc('username_available', { candidate: username });
    if (avail.error) return setFormError('Could not check the username. Is the database migration applied?');
    if (!avail.data) return setError('username', { message: 'That username is taken' });
    const { error } = await supabase.auth.signUp({
      email: v.email, password: v.password,
      options: { data: { username, display_name: v.displayName }, emailRedirectTo: `${window.location.origin}/login` },
    });
    if (error) return setFormError(authErrorMessage(error));
    setSentTo(v.email);
  };

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a confirmation link to ${sentTo}. Open it, then sign in.`} footer={<Link to="/login">Go to sign in</Link>}>
        <p className={styles.ok} role="status">Account created.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" footer={<>Already registered? <Link to="/login">Sign in</Link></>}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField label="Name" autoComplete="name" error={errors.displayName?.message} {...register('displayName')} />
        <TextField label="Username" autoComplete="username" autoCapitalize="none" hint="People find you by this" error={errors.username?.message} {...register('username')} />
        <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <TextField label="Password" type="password" autoComplete="new-password" hint="10+ characters with upper, lower and a number" error={errors.password?.message} {...register('password')} />
        {formError && <p className={styles.formError} role="alert">{formError}</p>}
        <Button type="submit" loading={isSubmitting}>{isSubmitting ? 'Creating…' : 'Create account'}</Button>
      </form>
    </AuthLayout>
  );
}
