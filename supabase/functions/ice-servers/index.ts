// Supabase Edge Function: returns ICE servers for the signed-in user.
// Secrets (set with `supabase secrets set`):
//   TURN_URLS    comma list, e.g. "turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp"
//   TURN_SECRET  the coturn `static-auth-secret` (use-auth-secret mode)
// Credentials are short-lived (1 hour) and tied to the user id, so the shared secret never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const iceServers: Record<string, unknown>[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
  const urls = (Deno.env.get('TURN_URLS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const secret = Deno.env.get('TURN_SECRET');
  if (urls.length && secret) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${user.id}`;
    iceServers.push({ urls, username, credential: await hmacSha1Base64(secret, username) });
  }
  return json({ iceServers });
});
