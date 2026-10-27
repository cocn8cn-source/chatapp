import { flattenOldestFirst, upsertMessage } from './messageCache';
import type { Message } from './api';

const msg = (id: string, t: string, extra: Partial<Message> = {}): Message => ({ id, conversation_id: 'c', sender_id: 'u', body: id, created_at: t, ...extra });

describe('messageCache', () => {
  it('does not duplicate when the server copy of an optimistic message arrives', () => {
    let d = upsertMessage(undefined, msg('a', '2026-01-01T00:00:01Z', { status: 'pending' }));
    d = upsertMessage(d, msg('a', '2026-01-01T00:00:02Z'));
    const list = flattenOldestFirst(d);
    expect(list).toHaveLength(1);
    expect(list[0].created_at).toBe('2026-01-01T00:00:02Z');
  });
  it('orders oldest first across pages', () => {
    const d = { pages: [[msg('c', '2026-01-01T00:00:03Z'), msg('b', '2026-01-01T00:00:02Z')], [msg('a', '2026-01-01T00:00:01Z')]], pageParams: [undefined, 'x'] };
    expect(flattenOldestFirst(d).map((m) => m.id)).toEqual(['a', 'b', 'c']);
  });
});
