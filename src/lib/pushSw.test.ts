// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const ORIGIN = 'https://chatspace.example';

function loadWorker() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; opts: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  let windows: { url: string; postMessage: (m: unknown) => void; focus: () => Promise<void> }[] = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    skipWaiting: () => { (self as Record<string, unknown>)._skipped = true; },
    registration: {
      // Browsers reject `renotify: true` without a `tag` with a TypeError — emulate that.
      showNotification: (title: string, opts: Record<string, unknown>) => {
        if (opts?.renotify && !opts.tag) return Promise.reject(new TypeError('renotify requires a tag'));
        shown.push({ title, opts });
        return Promise.resolve();
      },
    },
    clients: { matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } },
  };
  runInNewContext(readFileSync('public/push-sw.js', 'utf8'), { self, URL, console });
  return {
    self, shown, opened,
    setWindows: (w: typeof windows) => { windows = w; },
    async fire(type: string, event: Record<string, unknown>) {
      let pending: Promise<unknown> | undefined;
      handlers[type]({ ...event, waitUntil: (p: Promise<unknown>) => { pending = p; } });
      await pending;
    },
  };
}
const push = (obj: unknown) => ({ data: { json: () => obj, text: () => 'plain' } });

describe('push-sw.js', () => {
  it('shows a notification for a normal payload', async () => {
    const w = loadWorker();
    await w.fire('push', push({ title: 'Mira', body: 'hi', url: '/app/chats/a?message=1', tag: 't1', kind: 'message' }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].opts).toMatchObject({ body: 'hi', tag: 't1', renotify: true, data: { url: '/app/chats/a?message=1' } });
  });
  it('still shows one when there is no tag (renotify without a tag would throw)', async () => {
    const w = loadWorker();
    await w.fire('push', push({ title: 'Mira', body: 'no tag' }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].opts.renotify).toBeUndefined();
  });
  it('shows plain-text payloads (e.g. DevTools "Push" test)', async () => {
    const w = loadWorker();
    await w.fire('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'hello' } });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0].opts.body).toBe('hello');
  });
  it('never opens a URL outside /app/', async () => {
    const w = loadWorker();
    await w.fire('push', push({ title: 'x', url: 'https://evil.example' }));
    expect(w.shown[0].opts.data).toEqual({ url: '/app/chats' });
  });
  it('click: routes the already-open app via postMessage and focuses it', async () => {
    const w = loadWorker();
    const msgs: unknown[] = []; let focused = false;
    w.setWindows([{ url: `${ORIGIN}/app/settings`, postMessage: (m) => msgs.push(m), focus: async () => { focused = true; } }]);
    await w.fire('notificationclick', { notification: { close: () => {}, data: { url: '/app/chats/a?message=1' } } });
    expect(msgs).toEqual([{ type: 'NOTIFICATION_CLICK', url: '/app/chats/a?message=1' }]);
    expect(focused).toBe(true);
    expect(w.opened).toEqual([]);
  });
  it('click: cold-starts the app at the target when no window is open', async () => {
    const w = loadWorker();
    await w.fire('notificationclick', { notification: { close: () => {}, data: { url: '/app/calls' } } });
    expect(w.opened).toEqual([`${ORIGIN}/app/calls`]);
  });
  it('click: ignores a hostile URL', async () => {
    const w = loadWorker();
    await w.fire('notificationclick', { notification: { close: () => {}, data: { url: '//evil.example/x' } } });
    expect(w.opened).toEqual([`${ORIGIN}/app/chats`]);
  });
});
