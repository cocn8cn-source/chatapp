import { envResult } from '@/config/env';
import { supabase } from '@/lib/supabase';

export type PushStatus = 'unsupported' | 'not-configured' | 'default' | 'granted' | 'denied' | 'subscribed';

export function publicPushKey(): string | null {
  if (!envResult.ok) return null;
  const key = envResult.env.VITE_VAPID_PUBLIC_KEY?.trim();
  return key ? key : null;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * The registration of an ACTIVE service worker. `pushManager.subscribe()` fails on a worker that is
 * still installing, so wait for `.ready` (with a timeout: in `npm run dev` no worker is registered,
 * and `.ready` would otherwise never settle).
 */
async function registration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch { return null; }
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return true; // cannot tell; keep it
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

/** Turns the opaque errors browsers throw into something a person can act on. */
function explainPushError(e: unknown): Error {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'NotAllowedError') return new Error('Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.');
  if (err?.name === 'AbortError') return new Error('The browser’s push service could not be reached. Check your connection (and that your browser has push enabled), then try again.');
  if (err?.name === 'InvalidStateError') return new Error('A previous notification subscription is in the way. Reload the app and try again.');
  if (e instanceof Error) return e;
  return new Error(err?.message || 'Could not turn on notifications.');
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (!publicPushKey()) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  const reg = await registration(3_000);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  return sub ? 'subscribed' : 'granted';
}

/** Must be called from a user gesture. Requests permission, subscribes and stores the endpoint. */
export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser does not support web push. On iPhone, install the app to the Home Screen first.');
  const key = publicPushKey();
  if (!key) throw new Error('Push is not configured. Set VITE_VAPID_PUBLIC_KEY and deploy the send-push function.');
  if (!supabase) throw new Error('Supabase is not configured.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied'
    ? 'Notifications are blocked in your browser settings. Allow them for this site and try again.'
    : 'Notification permission was not granted.');

  const reg = await registration();
  if (!reg) throw new Error('The app’s background worker is not active yet. Reload the app and try again. (Push only works in the deployed app, not in `npm run dev`.)');

  const appKey = urlBase64ToUint8Array(key);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with a different VAPID key (key rotated, or the wrong key was deployed once)
  // can never receive our pushes. Drop it and subscribe again with the current key.
  if (sub && !sameKey(sub, appKey)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  try {
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey.buffer as ArrayBuffer });
  } catch (e) { throw explainPushError(e); }

  await saveSubscription(sub);
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('The browser returned an incomplete subscription.');
  const { error } = await supabase.rpc('save_push_subscription', {
    endpoint: json.endpoint, p256dh_key: json.keys.p256dh, auth_key: json.keys.auth, ua: navigator.userAgent,
  });
  if (error) throw new Error(`Could not save this device for notifications: ${error.message}`);
}

/**
 * Silent, no prompt: if this browser already has permission and a subscription, make sure the
 * server has it for the account that is signed in now (covers sign-out/in, a wiped table, key refresh).
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (!pushSupported() || !publicPushKey() || !supabase) return;
    if (Notification.permission !== 'granted') return;
    const reg = await registration(4_000);
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await saveSubscription(sub);
  } catch { /* best effort */ }
}

/** Removes this browser's subscription from both the browser and the server. */
export async function disablePush(): Promise<void> {
  const reg = await registration(3_000);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await Promise.resolve(supabase?.rpc('delete_push_subscription', { endpoint })).catch(() => {});
  }
}

/** Sign-out path: stop this browser receiving the previous account's notifications. */
export async function detachPushSubscription(): Promise<void> {
  const reg = await registration(3_000);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await Promise.resolve(supabase?.rpc('delete_push_subscription', { endpoint })).catch(() => {});
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
