import { authErrorMessage } from './authErrors';

describe('authErrorMessage', () => {
  it('names a rejected key instead of blaming the password', () => {
    expect(authErrorMessage({ message: 'Invalid API key', status: 401 })).toMatch(/key was rejected/);
  });
  it('maps wrong credentials', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 })).toBe('Email or password is incorrect.');
  });
  it('maps unconfirmed email and rate limits', () => {
    expect(authErrorMessage({ code: 'email_not_confirmed', message: 'Email not confirmed' })).toMatch(/Confirm your email/);
    expect(authErrorMessage({ status: 429, message: 'x' })).toMatch(/Too many/);
  });
  it('maps network failures', () => {
    expect(authErrorMessage({ message: 'Failed to fetch' })).toMatch(/Could not reach Supabase/);
  });
});
