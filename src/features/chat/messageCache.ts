import type { InfiniteData } from '@tanstack/react-query';
import type { Message } from './api';

export type MessagePages = InfiniteData<Message[], string | undefined>;

/** Insert or replace by id so realtime events, optimistic sends and refetches never duplicate. */
export function upsertMessage(data: MessagePages | undefined, msg: Message): MessagePages {
  if (!data) return { pages: [[msg]], pageParams: [undefined] };
  let found = false;
  const pages = data.pages.map((p) => p.map((m) => { if (m.id === msg.id) { found = true; return { ...m, ...msg }; } return m; }));
  if (!found) pages[0] = [msg, ...(pages[0] ?? [])];
  return { ...data, pages };
}

export function patchMessage(data: MessagePages | undefined, id: string, patch: (m: Message) => Message): MessagePages | undefined {
  if (!data) return data;
  let changed = false;
  const pages = data.pages.map((p) => p.map((m) => {
    if (m.id !== id) return m;
    changed = true;
    return patch(m);
  }));
  return changed ? { ...data, pages } : data;
}

export function removeMessage(data: MessagePages | undefined, id: string): MessagePages | undefined {
  if (!data) return data;
  const pages = data.pages.map((p) => p.filter((m) => m.id !== id));
  return { ...data, pages };
}

export function flattenOldestFirst(data: MessagePages | undefined): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (const m of (data?.pages.flat() ?? [])) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
