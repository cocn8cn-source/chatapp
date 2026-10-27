/* Imported by the Workbox-generated service worker (see `importScripts` in vite.config.ts).
 * Contains only push handlers. Keep it dependency-free and small. */

const FALLBACK_PATH = '/app/chats';

/** Only in-app paths are ever opened from a notification. */
function safePath(url) {
  if (typeof url !== 'string') return FALLBACK_PATH;
  if (url !== '/app' && !url.startsWith('/app/')) return FALLBACK_PATH;
  if (url.startsWith('//') || url.includes('://') || url.includes('\\')) return FALLBACK_PATH;
  return url === '/app' || url === '/app/' ? FALLBACK_PATH : url;
}

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'ChatSpace', body: event.data ? event.data.text() : 'New activity' };
  }
  if (!data || typeof data !== 'object') data = {};

  const title = typeof data.title === 'string' && data.title ? data.title : 'ChatSpace';
  const body = typeof data.body === 'string' ? data.body : 'You have new activity.';

  const options = {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    requireInteraction: data.kind === 'call',
    data: { url: safePath(data.url) },
  };
  // `renotify: true` without a `tag` makes showNotification() throw a TypeError, and a push
  // that shows nothing can get the subscription revoked (iOS is strict). Only set both together.
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag;
    options.renotify = true;
  }

  // Always show something: browsers require every push to produce a visible notification.
  event.waitUntil(
    self.registration.showNotification(title, options).catch(() =>
      self.registration.showNotification('ChatSpace', { body, icon: '/icons/icon-192.png', data: options.data }),
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);

  event.waitUntil((async () => {
    const target = new URL(path, self.location.origin);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((c) => {
      try { return new URL(c.url).origin === self.location.origin; } catch { return false; }
    });

    if (open) {
      // App already open (or backgrounded): ask it to route client-side — no reload, works on iOS.
      open.postMessage({ type: 'NOTIFICATION_CLICK', url: target.pathname + target.search + target.hash });
      try { await open.focus(); } catch { /* focus can be refused; the message still navigates */ }
      return;
    }
    // App closed: cold-start straight into the target. Signed-out users are sent to /login
    // and brought back here after signing in.
    await self.clients.openWindow(target.href);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
