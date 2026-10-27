import { isMuted, visibleConversations } from './conversationList';
import type { ConversationItem } from './api';

const c = (id: string, over: Partial<ConversationItem> = {}): ConversationItem => ({
  id, kind: 'direct', title: null, description: '', photo_path: null, created_by: 'me',
  last_message_at: null, last_message_preview: null,
  peer_id: 'o' + id, peer_username: 'user' + id, peer_display_name: 'Person ' + id, peer_avatar_path: null,
  peer_last_read_at: null, peer_last_delivered_at: null, pinned_at: null, archived_at: null, muted_until: null,
  my_role: 'member', member_count: 2, unread: 0, blocked: false, blocked_by_peer: false, ...over,
});

describe('visibleConversations', () => {
  const items = [
    c('1', { last_message_at: '2026-01-02T00:00:00Z' }),
    c('2', { last_message_at: '2026-01-03T00:00:00Z', unread: 2 }),
    c('3', { last_message_at: '2026-01-01T00:00:00Z', pinned_at: '2026-01-01T00:00:00Z' }),
    c('4', { archived_at: '2026-01-01T00:00:00Z' }),
  ];
  it('puts pinned first, then newest activity; hides archived', () => {
    expect(visibleConversations(items, 'all', '').map((x) => x.id)).toEqual(['3', '2', '1']);
  });
  it('filters unread and archived tabs', () => {
    expect(visibleConversations(items, 'unread', '').map((x) => x.id)).toEqual(['2']);
    expect(visibleConversations(items, 'archived', '').map((x) => x.id)).toEqual(['4']);
  });
  it('filters by name', () => {
    expect(visibleConversations(items, 'all', 'person 2').map((x) => x.id)).toEqual(['2']);
  });
  it('detects active mutes only', () => {
    expect(isMuted({ muted_until: '2999-01-01T00:00:00Z' })).toBe(true);
    expect(isMuted({ muted_until: '2000-01-01T00:00:00Z' })).toBe(false);
    expect(isMuted({ muted_until: null })).toBe(false);
  });
});
