import { parseEnv } from './env';

describe('parseEnv', () => {
  it('reports missing Supabase variables', () => {
    const r = parseEnv({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(expect.arrayContaining(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']));
  });
  it('accepts a valid configuration', () => {
    const r = parseEnv({ VITE_SUPABASE_URL: 'https://abc.supabase.co', VITE_SUPABASE_ANON_KEY: 'x'.repeat(30) });
    expect(r.ok).toBe(true);
  });
  it('tolerates quotes and surrounding spaces', () => {
    const r = parseEnv({ VITE_SUPABASE_URL: ' "https://abc.supabase.co" ', VITE_SUPABASE_ANON_KEY: `'${'k'.repeat(30)}' ` });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.env.VITE_SUPABASE_URL).toBe('https://abc.supabase.co'); expect(r.env.VITE_SUPABASE_ANON_KEY).toBe('k'.repeat(30)); }
  });
});
