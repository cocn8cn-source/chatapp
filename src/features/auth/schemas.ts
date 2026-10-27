import { z } from 'zod';

export const emailField = z.string().trim().email('Enter a valid email address');
export const passwordField = z.string()
  .min(10, 'Use at least 10 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');
export const usernameField = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9_]{3,24}$/, '3–24 characters: letters, numbers, underscore');

export const loginSchema = z.object({ email: emailField, password: z.string().min(1, 'Enter your password') });
export const registerSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a name').max(50),
  username: usernameField, email: emailField, password: passwordField,
});
export const forgotSchema = z.object({ email: emailField });
export const newPasswordSchema = z.object({ password: passwordField });
export const changeEmailSchema = z.object({ email: emailField });
export const profileSchema = z.object({
  displayName: z.string().trim().min(1, 'Enter a name').max(50),
  username: usernameField,
  about: z.string().max(140, 'Keep it under 140 characters'),
});
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
