import { callReducer, initialCall, isBusy, type CallEvent, type CallState } from './callMachine';

const run = (events: CallEvent[], from: CallState = initialCall) => events.reduce(callReducer, from);
const out: CallEvent[] = [{ type: 'BEGIN_OUTGOING', peerId: 'b', conversationId: 'c', kind: 'voice' }, { type: 'CALL_CREATED', callId: 'k1' }];
const inc: CallEvent = { type: 'INCOMING', callId: 'k2', peerId: 'a', conversationId: 'c', kind: 'video' };

describe('call state machine', () => {
  it('outgoing call that is answered and connects', () => {
    const s = run([...out, { type: 'REMOTE_ANSWERED' }, { type: 'CONNECTED' }]);
    expect(s.phase).toBe('connected');
    expect(s.callId).toBe('k1');
  });
  it('incoming call accepted', () => {
    expect(run([inc, { type: 'ACCEPT' }, { type: 'CONNECTED' }]).phase).toBe('connected');
  });
  it('terminal reasons', () => {
    expect(run([...out, { type: 'REMOTE_REJECTED' }]).endReason).toBe('rejected');
    expect(run([...out, { type: 'NO_ANSWER' }]).endReason).toBe('no_answer');
    expect(run([...out, { type: 'HANGUP' }]).endReason).toBe('cancelled');
    expect(run([inc, { type: 'REMOTE_CANCELLED' }]).endReason).toBe('missed');
    expect(run([inc, { type: 'DECLINE' }]).endReason).toBe('declined');
    expect(run([inc, { type: 'ACCEPT' }, { type: 'FAILED', reason: 'timeout' }]).endReason).toBe('timeout');
  });
  it('ignores duplicate and out-of-order events', () => {
    const ended = run([...out, { type: 'REMOTE_ANSWERED' }, { type: 'CONNECTED' }, { type: 'REMOTE_ENDED' }]);
    expect(run([{ type: 'REMOTE_ENDED' }, { type: 'HANGUP' }, { type: 'CONNECTED' }], ended)).toEqual(ended);
    expect(run([{ type: 'CONNECTED' }, { type: 'ACCEPT' }])).toEqual(initialCall);
  });
  it('first terminal event wins when answer and cancel race', () => {
    const s = run([inc, { type: 'REMOTE_CANCELLED' }, { type: 'ACCEPT' }]);
    expect(s.phase).toBe('ended');
    expect(s.endReason).toBe('missed');
  });
  it('a second incoming call cannot replace an active one', () => {
    const s = run([inc, { type: 'ACCEPT' }, { type: 'INCOMING', callId: 'k9', peerId: 'z', conversationId: 'c', kind: 'voice' }]);
    expect(s.callId).toBe('k2');
    expect(isBusy(s.phase)).toBe(true);
  });
  it('reconnecting returns to connected', () => {
    const s = run([...out, { type: 'REMOTE_ANSWERED' }, { type: 'CONNECTED' }, { type: 'DISCONNECTED' }]);
    expect(s.phase).toBe('reconnecting');
    expect(callReducer(s, { type: 'CONNECTED' }).phase).toBe('connected');
  });
  it('disconnect during connecting does not skip ahead', () => {
    expect(run([...out, { type: 'REMOTE_ANSWERED' }, { type: 'DISCONNECTED' }]).phase).toBe('connecting');
  });
  it('new calls can start from the ended screen, and RESET returns to idle', () => {
    const ended = run([...out, { type: 'HANGUP' }]);
    expect(callReducer(ended, inc).phase).toBe('incoming');
    expect(callReducer(ended, { type: 'RESET' })).toEqual(initialCall);
    expect(callReducer(initialCall, { type: 'RESET' })).toEqual(initialCall);
  });
});
