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

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.getRegistration() ?? await navigator.serviceWorker.ready;
  } catch { return null; }
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (!publicPushKey()) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  const reg = await registration();
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
  if (!reg) throw new Error('The service worker is not active yet. Reload the app and try again.');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key).buffer as ArrayBuffer });
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('The browser returned an incomplete subscription.');
  const { error } = await supabase.rpc('save_push_subscription', {
    endpoint: json.endpoint, p256dh_key: json.keys.p256dh, auth_key: json.keys.auth, ua: navigator.userAgent,
  });
  if (error) throw error;
}

/** Removes this browser's subscription from both the browser and the server. */
export async function disablePush(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => {});
    await Promise.resolve(supabase?.rpc('delete_push_subscription', { endpoint })).catch(() => {});
  }
}

/** Sign-out path: stop this browser receiving the previous account's notifications. */
export async function detachPushSubscription(): Promise<void> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await Promise.resolve(supabase?.rpc('delete_push_subscription', { endpoint })).catch(() => {});
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}
