import { countMissed } from './missed';
import type { CallHistoryItem } from './api';

const call = (over: Partial<CallHistoryItem>): CallHistoryItem => ({
  id: 'x', conversation_id: 'c', caller_id: 'a', callee_id: 'me', kind: 'voice', status: 'missed', end_reason: null,
  created_at: '2026-02-01T00:00:00Z', answered_at: null, ended_at: null,
  peer_id: 'a', peer_username: 'alex', peer_display_name: 'Alex', peer_avatar_path: null, ...over,
});

describe('countMissed', () => {
  it('counts only unanswered incoming calls after the last visit', () => {
    const items = [call({}), call({ status: 'cancelled' }), call({ status: 'ended' }), call({ callee_id: 'a', caller_id: 'me' }), call({ created_at: '2026-01-01T00:00:00Z' })];
    expect(countMissed(items, 'me', '2026-01-15T00:00:00Z')).toBe(2);
  });
});
