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
import { forgotSchema } from './schemas';
import styles from './Auth.module.css';

type Values = z.infer<typeof forgotSchema>;

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = async ({ email }: Values) => {
    setFormError(null);
    if (!supabase) return setFormError('Supabase is not configured.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) return setFormError(authErrorMessage(error));
    setSent(true);
  };

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we will send a reset link." footer={<Link to="/login">Back to sign in</Link>}>
      {sent ? <p className={styles.ok} role="status">If that email has an account, a reset link is on its way.</p> : (
        <form className={styles.form} onSubmit={handleSubmit(onSubmit)} noValidate>
          <TextField label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          {formError && <p className={styles.formError} role="alert">{formError}</p>}
          <Button type="submit" loading={isSubmitting}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}
