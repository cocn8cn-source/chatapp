import type { ConversationItem } from './api';

export type ListTab = 'all' | 'unread' | 'archived';

export function visibleConversations(items: ConversationItem[], tab: ListTab, filter: string): ConversationItem[] {
  const f = filter.trim().toLowerCase();
  return items
    .filter((c) => (tab === 'archived' ? !!c.archived_at : !c.archived_at))
    .filter((c) => tab !== 'unread' || c.unread > 0)
    .filter((c) => !f || `${c.peer_display_name ?? ''} ${c.peer_username ?? ''} ${c.title ?? ''}`.toLowerCase().includes(f))
    .sort((a, b) =>
      Number(!!b.pinned_at) - Number(!!a.pinned_at) ||
      (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
}

export function isMuted(c: Pick<ConversationItem, 'muted_until'>, now = Date.now()): boolean {
  return !!c.muted_until && new Date(c.muted_until).getTime() > now;
}
