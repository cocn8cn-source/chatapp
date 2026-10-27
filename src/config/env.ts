import { z } from 'zod';

const schema = z.object({
  VITE_SUPABASE_URL: z.string().trim().url(),
  VITE_SUPABASE_ANON_KEY: z.string().trim().min(20),
  VITE_APP_NAME: z.string().default('ChatSpace'),
  VITE_VAPID_PUBLIC_KEY: z.string().optional(),
  VITE_LIVEKIT_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;
export type EnvResult = { ok: true; env: Env } | { ok: false; missing: string[] };

/** Windows editors often leave quotes or spaces around values; strip them. */
function clean(v: unknown): unknown {
  return typeof v === 'string' ? v.trim().replace(/^(["'])(.*)\1$/, '$2').trim() : v;
}

export function parseEnv(raw: Record<string, unknown>): EnvResult {
  const r = schema.safeParse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, clean(v)])));
  if (r.success) return { ok: true, env: r.data };
  return { ok: false, missing: [...new Set(r.error.issues.map((i) => String(i.path[0])))] };
}

export const envResult = parseEnv(import.meta.env as Record<string, unknown>);
