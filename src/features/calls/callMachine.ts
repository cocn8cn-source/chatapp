/** Pure call state machine. Invalid or duplicate events are ignored, so racing events cannot corrupt state. */
export type CallKind = 'voice' | 'video';
export type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'reconnecting' | 'ended';
export type EndReason =
  | 'hangup' | 'remote_hangup' | 'declined' | 'rejected' | 'missed' | 'no_answer' | 'cancelled'
  | 'busy' | 'failed' | 'timeout' | 'permission_denied' | 'no_device' | 'unsupported';

export type CallState = {
  phase: Phase; callId?: string; conversationId?: string; peerId?: string; kind?: CallKind;
  direction?: 'outgoing' | 'incoming'; endReason?: EndReason;
};

export type CallEvent =
  | { type: 'BEGIN_OUTGOING'; peerId: string; conversationId: string; kind: CallKind }
  | { type: 'CALL_CREATED'; callId: string }
  | { type: 'INCOMING'; callId: string; peerId: string; conversationId: string; kind: CallKind }
  | { type: 'ACCEPT' } | { type: 'DECLINE' }
  | { type: 'REMOTE_ANSWERED' } | { type: 'REMOTE_REJECTED' } | { type: 'REMOTE_CANCELLED' }
  | { type: 'NO_ANSWER' } | { type: 'CONNECTED' } | { type: 'DISCONNECTED' }
  | { type: 'HANGUP' } | { type: 'REMOTE_ENDED' }
  | { type: 'FAILED'; reason: EndReason } | { type: 'RESET' };

export const initialCall: CallState = { phase: 'idle' };
const end = (s: CallState, endReason: EndReason): CallState => ({ ...s, phase: 'ended', endReason });
export const isBusy = (p: Phase) => p !== 'idle' && p !== 'ended';

export function callReducer(s: CallState, e: CallEvent): CallState {
  if (e.type === 'RESET') return s.phase === 'ended' ? initialCall : s;

  switch (s.phase) {
    case 'idle':
    case 'ended':
      if (e.type === 'BEGIN_OUTGOING') return { phase: 'outgoing', peerId: e.peerId, conversationId: e.conversationId, kind: e.kind, direction: 'outgoing' };
      if (e.type === 'INCOMING') return { phase: 'incoming', callId: e.callId, peerId: e.peerId, conversationId: e.conversationId, kind: e.kind, direction: 'incoming' };
      return s;
    case 'outgoing':
      switch (e.type) {
        case 'CALL_CREATED': return s.callId ? s : { ...s, callId: e.callId };
        case 'REMOTE_ANSWERED': return { ...s, phase: 'connecting' };
        case 'REMOTE_REJECTED': return end(s, 'rejected');
        case 'NO_ANSWER': return end(s, 'no_answer');
        case 'HANGUP': return end(s, 'cancelled');
        case 'FAILED': return end(s, e.reason);
        default: return s;
      }
    case 'incoming':
      switch (e.type) {
        case 'ACCEPT': return { ...s, phase: 'connecting' };
        case 'DECLINE': return end(s, 'declined');
        case 'REMOTE_CANCELLED':
        case 'NO_ANSWER': return end(s, 'missed');
        case 'FAILED': return end(s, e.reason);
        default: return s;
      }
    case 'connecting':
    case 'connected':
    case 'reconnecting':
      switch (e.type) {
        case 'CONNECTED': return { ...s, phase: 'connected' };
        case 'DISCONNECTED': return s.phase === 'connected' ? { ...s, phase: 'reconnecting' } : s;
        case 'HANGUP': return end(s, 'hangup');
        case 'REMOTE_ENDED': return end(s, 'remote_hangup');
        case 'FAILED': return end(s, e.reason);
        default: return s;
      }
  }
}

export function endMessage(r: EndReason | undefined, direction?: 'outgoing' | 'incoming'): string {
  switch (r) {
    case 'hangup': case 'remote_hangup': return 'Call ended';
    case 'declined': return 'Call declined';
    case 'rejected': return 'They declined the call';
    case 'missed': return 'Missed call';
    case 'no_answer': return 'No answer';
    case 'cancelled': return direction === 'outgoing' ? 'Call cancelled' : 'Call ended';
    case 'busy': return 'They are on another call';
    case 'permission_denied': return 'Microphone or camera access was denied. Allow it in your browser settings and try again.';
    case 'no_device': return 'No microphone or camera was found.';
    case 'unsupported': return 'Calling is not supported in this browser.';
    case 'timeout': return 'The call could not connect in time';
    default: return 'The call could not connect';
  }
}
