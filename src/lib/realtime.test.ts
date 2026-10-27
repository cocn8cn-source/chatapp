import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { channel: (topic: string) => ({ topic }) },
}));

import { createChannel } from './realtime';

const topicOf = (channel: unknown) => (channel as { topic: string }).topic;

describe('createChannel', () => {
  it('gives every subscription its own topic', () => {
    const a = createChannel('thread:1');
    const b = createChannel('thread:1');
    expect(a).not.toBe(b);
    expect(topicOf(a)).not.toBe(topicOf(b));
    expect(topicOf(a).startsWith('thread:1')).toBe(true);
  });
});
