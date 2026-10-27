import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/auth';
import { Button } from '@/components/Button/Button';
import { TextField } from '@/components/TextField/TextField';
import { AuthLayout } from './AuthLayout';
import { loginSchema } from './schemas';
import { authErrorMessage } from './authErrors';
import styles from './Auth.module.css';

type Values = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const session = useAuth((s) => s.session);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(loginSchema) });

  if (session) return <Navigate to="/app/chats" replace />;

  const onSubmit = async (v: Values) => {
    setFormError(null);
    if (!supabase) return setFormError('Supabase is not configured.');
    const { error } = await supabase.auth.signInWithPassword(v);
    if (error) {
      setFormError(authErrorMessage(error));
      return;
    }
    navigate('/app/chats', { replace: true });
  };

  return (
    <AuthLayout title="Welcome back" footer={<>New here? <Link to="/register">Create an account</Link></>}>
      <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
        <TextField label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        {formError && <p className={styles.formError} role="alert">{formError}</p>}
        <Button type="submit" loading={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
        <Link to="/forgot-password">Forgot your password?</Link>
      </form>
    </AuthLayout>
  );
}
