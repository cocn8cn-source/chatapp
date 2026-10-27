// Supabase Edge Function: permanently deletes the authenticated user's account and data.
// Storage objects do not cascade from auth.users, so photos and uploaded chat files are
// removed explicitly before the auth user is deleted. The client must type DELETE first.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== 'DELETE') return json({ error: 'type DELETE to confirm' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Hand over or remove groups where this user is an admin, so no group is left unmanaged.
  const { data: memberships } = await admin.from('conversation_members')
    .select('conversation_id, role, conversations(kind)').eq('user_id', user.id).eq('role', 'admin');
  for (const membership of memberships ?? []) {
    if ((membership.conversations as { kind?: string } | null)?.kind !== 'group') continue;
    const { data: others } = await admin.from('conversation_members')
      .select('user_id, role, joined_at').eq('conversation_id', membership.conversation_id)
      .neq('user_id', user.id).order('joined_at', { ascending: true });
    if (!others?.length) {
      await admin.from('conversations').delete().eq('id', membership.conversation_id);
      continue;
    }
    if (!others.some((m) => m.role === 'admin')) {
      await admin.from('conversation_members').update({ role: 'admin' })
        .eq('conversation_id', membership.conversation_id).eq('user_id', others[0].user_id);
    }
  }

  // Remove the user's profile photos.
  const { data: avatarFiles } = await admin.storage.from('avatars').list(user.id, { limit: 1000 });
  if (avatarFiles?.length) {
    await admin.storage.from('avatars').remove(avatarFiles.map((f) => `${user.id}/${f.name}`)).catch(() => {});
  }

  // Remove chat media uploaded by this user (files are keyed by conversation/message).
  const { data: attachments } = await admin.from('attachments').select('storage_path').eq('uploader_id', user.id);
  const paths = (attachments ?? []).map((a) => a.storage_path);
  for (let i = 0; i < paths.length; i += 100) {
    await admin.storage.from('chat-media').remove(paths.slice(i, i + 100)).catch(() => {});
  }

  // Remove custom group photos the user uploaded.
  const { data: ownedGroups } = await admin.from('conversations')
    .select('id, photo_path').eq('created_by', user.id).not('photo_path', 'is', null);
  for (const group of ownedGroups ?? []) {
    if (group.photo_path) await admin.storage.from('group-photos').remove([group.photo_path]).catch(() => {});
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return json({ error: 'Account deletion failed. Please contact support.' }, 500);
  return json({ deleted: true });
});
