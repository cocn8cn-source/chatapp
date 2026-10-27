/* Imported by the Workbox-generated service worker. Contains only push handlers. */
self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'ChatSpace', body: event.data ? event.data.text() : 'New activity' }; }
  const title = typeof data.title === 'string' ? data.title : 'ChatSpace';
  const body = typeof data.body === 'string' ? data.body : 'You have new activity.';
  const url = typeof data.url === 'string' && data.url.startsWith('/app/') ? data.url : '/app/chats';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: typeof data.tag === 'string' ? data.tag : undefined,
    renotify: true,
    requireInteraction: data.kind === 'call',
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app/chats', self.location.origin);
  if (target.origin !== self.location.origin) target.href = new URL('/app/chats', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        try { await client.navigate(target.href); } catch { /* fall through to focus */ }
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
