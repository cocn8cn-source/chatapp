import { passwordField, usernameField, registerSchema } from './schemas';

describe('auth schemas', () => {
  it('rejects weak passwords', () => {
    expect(passwordField.safeParse('short').success).toBe(false);
    expect(passwordField.safeParse('alllowercase123').success).toBe(false);
    expect(passwordField.safeParse('GoodPassw0rdHere').success).toBe(true);
  });
  it('normalizes and validates usernames', () => {
    expect(usernameField.parse(' Ali_99 ')).toBe('ali_99');
    expect(usernameField.safeParse('a b').success).toBe(false);
    expect(usernameField.safeParse('ab').success).toBe(false);
  });
  it('validates a full registration', () => {
    const r = registerSchema.safeParse({ displayName: 'Ali', username: 'ali_99', email: 'a@b.co', password: 'GoodPassw0rdHere' });
    expect(r.success).toBe(true);
  });
});
