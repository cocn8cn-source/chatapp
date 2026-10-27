// Supabase Edge Function: mints a LiveKit access token for an active group call.
// The caller must be a member of the conversation; membership is checked twice:
// by RLS on the group_calls row and by the join_group_call RPC.
//
// Secrets: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signJwt(payload: Record<string, unknown>, secret: string) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('LIVEKIT_URL');
  const apiKey = Deno.env.get('LIVEKIT_API_KEY');
  const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!url || !apiKey || !apiSecret) {
    return json({ error: 'Group calling is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.' }, 503);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const { call_id } = await req.json().catch(() => ({}));
  if (!call_id || typeof call_id !== 'string') return json({ error: 'call_id is required' }, 400);

  const { data: call, error } = await supabase.from('group_calls')
    .select('id, room_name, kind, conversation_id, status')
    .eq('id', call_id).eq('status', 'active').maybeSingle();
  if (error) return json({ error: 'could not verify the call' }, 500);
  if (!call) return json({ error: 'not allowed' }, 403);

  const { data: conversation } = await supabase.from('conversations')
    .select('title').eq('id', call.conversation_id).maybeSingle();
  const { data: profile } = await supabase.rpc('my_profile').single();
  const displayName = (profile as { display_name?: string } | null)?.display_name ?? user.email?.split('@')[0] ?? 'Guest';

  const { error: joinError } = await supabase.rpc('join_group_call', { call_id: call.id });
  if (joinError) return json({ error: 'not allowed' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    iss: apiKey,
    sub: user.id,
    name: displayName,
    metadata: JSON.stringify({ conversation_id: call.conversation_id }),
    nbf: now - 10,
    exp: now + 60 * 60,
    video: {
      room: call.room_name,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: false,
    },
  }, apiSecret);

  return json({
    url,
    token,
    roomName: call.room_name,
    conversationTitle: conversation?.title ?? 'Group call',
    kind: call.kind,
  });
});
