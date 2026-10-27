// Supabase Edge Function: delivers a Web Push message for one notifications row.
// Configure a Database Webhook on public.notifications INSERT that POSTs here with
// the x-webhook-secret header. VAPID private keys never reach the browser.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_WEBHOOK_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const expected = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!expected || req.headers.get('x-webhook-secret') !== expected) return json({ error: 'unauthorized' }, 401);

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!publicKey || !privateKey) return json({ error: 'push is not configured' }, 503);

  const body = await req.json().catch(() => ({}));
  const record = body?.record ?? body?.notification ?? null;
  if (!record?.id) return json({ error: 'notification record required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: notification, error } = await admin.from('notifications')
    .select('id, user_id, kind, title, body, url, pushed_at, created_at')
    .eq('id', record.id).maybeSingle();
  if (error || !notification) return json({ error: 'notification not found' }, 404);
  if (notification.pushed_at) return json({ skipped: 'already pushed' });

  const { data: settings } = await admin.from('user_settings')
    .select('notify_messages, notify_calls')
    .eq('user_id', notification.user_id).maybeSingle();
  const enabled = notification.kind === 'message'
    ? (settings?.notify_messages ?? true)
    : notification.kind === 'call' || notification.kind === 'missed_call' || notification.kind === 'group_call'
      ? (settings?.notify_calls ?? true)
      : true;
  if (!enabled) {
    await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', notification.id);
    return json({ skipped: 'preference disabled' });
  }

  const { data: subscriptions } = await admin.from('push_subscriptions')
    .select('id, endpoint, p256dh, auth').eq('user_id', notification.user_id);

  if (!subscriptions?.length) {
    await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', notification.id);
    return json({ sent: 0 });
  }

  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    publicKey,
    privateKey,
  );

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body,
    url: notification.url,
    tag: `chatspace-${notification.id}`,
    kind: notification.kind,
    requireInteraction: notification.kind === 'call',
  });

  let sent = 0;
  const expired: string[] = [];
  await Promise.all(subscriptions.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: notification.kind === 'call' ? 'high' : 'normal' });
      sent++;
      await admin.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', s.id);
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) expired.push(s.id);
    }
  }));
  if (expired.length) await admin.from('push_subscriptions').delete().in('id', expired);
  await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', notification.id);
  return json({ sent, removed: expired.length });
});
