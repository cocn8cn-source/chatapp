import { supabase } from '@/lib/supabase';
import { fetchOpenCalls, fetchSignals, getIceServers, rpcCall, sendSignal, type CallRow, type SignalRow } from './api';
import { isBusy, type CallKind, type EndReason } from './callMachine';
import { useCall } from './callStore';

type Session = {
  pc: RTCPeerConnection; local: MediaStream; callId: string; peerId: string; role: 'caller' | 'callee';
  candidates: RTCIceCandidateInit[]; remoteSet: boolean; seen: Set<number>; timers: number[]; restarted: boolean;
};
let session: Session | null = null;
const pending = new Map<string, SignalRow[]>(); // signals that arrived before the call was accepted
let myId: string | null = null;

class CallFailure extends Error { constructor(public reason: EndReason) { super(reason); } }
const dispatch = useCall.getState().dispatch;
const phase = () => useCall.getState().machine.phase;

export const callsSupported = () => typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

async function getMedia(kind: CallKind): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
  } catch (e) {
    const n = (e as DOMException).name;
    throw new CallFailure(n === 'NotAllowedError' || n === 'SecurityError' ? 'permission_denied' : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'no_device' : 'failed');
  }
}

function clearTimers() { session?.timers.forEach((t) => window.clearTimeout(t)); if (session) session.timers = []; }

export function closeSession() {
  if (!session) return;
  clearTimers();
  session.pc.onconnectionstatechange = null; session.pc.onicecandidate = null; session.pc.ontrack = null;
  session.pc.close();
  session.local.getTracks().forEach((t) => t.stop());
  session = null;
  useCall.getState().patch({ localStream: null, remoteStream: null, muted: false, cameraOff: false });
}

// close media as soon as the machine reaches `ended`, whichever code path got it there
useCall.subscribe((s, prev) => { if (s.machine.phase === 'ended' && prev.machine.phase !== 'ended') closeSession(); });

async function makePc(callId: string, peerId: string, role: 'caller' | 'callee', local: MediaStream): Promise<Session> {
  const ice = await getIceServers();
  if (!ice.hasTurn) useCall.getState().patch({ notice: 'No TURN relay is configured. Calls may fail on some networks.' });
  const pc = new RTCPeerConnection({ iceServers: ice.servers });
  const s: Session = { pc, local, callId, peerId, role, candidates: [], remoteSet: false, seen: new Set(), timers: [], restarted: false };
  local.getTracks().forEach((t) => pc.addTrack(t, local));
  pc.ontrack = (e) => useCall.getState().patch({ remoteStream: e.streams[0] ?? new MediaStream([e.track]) });
  pc.onicecandidate = (e) => { if (e.candidate) void sendSignal(callId, peerId, 'candidate', e.candidate.toJSON()).catch(() => {}); };
  pc.onconnectionstatechange = () => onConnectionState(s);
  session = s;
  useCall.getState().patch({ localStream: local });
  return s;
}

function onConnectionState(s: Session) {
  if (session !== s) return;
  const st = s.pc.connectionState;
  if (st === 'connected') { clearTimers(); dispatch({ type: 'CONNECTED' }); return; }
  if (st === 'disconnected') {
    dispatch({ type: 'DISCONNECTED' });
    s.timers.push(window.setTimeout(() => { if (session === s && s.pc.connectionState !== 'connected') void tryIceRestart(s); }, 4000));
  }
  if (st === 'failed') void tryIceRestart(s);
}

async function tryIceRestart(s: Session) {
  if (session !== s || s.pc.connectionState === 'connected') return;
  if (s.role === 'caller' && !s.restarted) {
    s.restarted = true;
    try {
      const offer = await s.pc.createOffer({ iceRestart: true });
      await s.pc.setLocalDescription(offer);
      await sendSignal(s.callId, s.peerId, 'offer', { sdp: offer.sdp });
    } catch { /* falls through to the failure timer */ }
  }
  s.timers.push(window.setTimeout(() => { if (session === s && s.pc.connectionState !== 'connected') void failCall('failed'); }, 12000));
}

async function failCall(reason: EndReason) {
  const id = session?.callId ?? useCall.getState().machine.callId;
  dispatch({ type: 'FAILED', reason });
  if (id) await rpcCall('end_call', { call_id: id, reason: reason === 'timeout' ? 'timeout' : 'failed' }).catch(() => {});
}

async function flushCandidates(s: Session) {
  s.remoteSet = true;
  for (const c of s.candidates.splice(0)) await s.pc.addIceCandidate(c).catch(() => {});
}

async function applySignal(s: Session, sig: SignalRow) {
  if (s.seen.has(sig.id)) return;
  s.seen.add(sig.id);
  const p = sig.payload as { sdp?: string } & RTCIceCandidateInit;
  try {
    if (sig.kind === 'offer') {
      if (s.pc.signalingState !== 'stable') return;
      await s.pc.setRemoteDescription({ type: 'offer', sdp: p.sdp });
      await flushCandidates(s);
      const answer = await s.pc.createAnswer();
      await s.pc.setLocalDescription(answer);
      await sendSignal(s.callId, s.peerId, 'answer', { sdp: answer.sdp });
    } else if (sig.kind === 'answer') {
      if (s.pc.signalingState !== 'have-local-offer') return;
      await s.pc.setRemoteDescription({ type: 'answer', sdp: p.sdp });
      await flushCandidates(s);
    } else if (s.remoteSet) {
      await s.pc.addIceCandidate(p).catch(() => {});
    } else {
      s.candidates.push(p);
    }
  } catch { /* a bad signal must not crash the call; the connection timers decide the outcome */ }
}

/** Realtime handler for rows of call_signals addressed to me. */
export function onSignal(sig: SignalRow) {
  if (session && session.callId === sig.call_id) { void applySignal(session, sig); return; }
  const list = pending.get(sig.call_id) ?? [];
  list.push(sig); pending.set(sig.call_id, list);
}

// ── user actions ──
export async function startOutgoing(conversationId: string, peerId: string, kind: CallKind) {
  if (isBusy(phase())) return;
  if (!callsSupported()) { dispatch({ type: 'BEGIN_OUTGOING', peerId, conversationId, kind }); dispatch({ type: 'FAILED', reason: 'unsupported' }); return; }
  dispatch({ type: 'BEGIN_OUTGOING', peerId, conversationId, kind });
  useCall.getState().patch({ notice: null });
  let local: MediaStream | null = null;
  try {
    local = await getMedia(kind);
    const row = await rpcCall('start_call', { cid: conversationId, call_kind: kind }).catch((e: { message?: string }) => {
      throw new CallFailure(/busy/i.test(e.message ?? '') ? 'busy' : 'failed');
    });
    dispatch({ type: 'CALL_CREATED', callId: row.id });
    if (phase() !== 'outgoing') { // user hung up while we were setting up
      local.getTracks().forEach((t) => t.stop());
      await rpcCall('end_call', { call_id: row.id, reason: 'hangup' }).catch(() => {});
      return;
    }
    const s = await makePc(row.id, peerId, 'caller', local);
    const offer = await s.pc.createOffer();
    await s.pc.setLocalDescription(offer);
    await sendSignal(row.id, peerId, 'offer', { sdp: offer.sdp });
    s.timers.push(window.setTimeout(async () => {
      if (session !== s || phase() !== 'outgoing') return;
      const r = await rpcCall('expire_call', { call_id: row.id }).catch(() => null);
      if (r?.status === 'missed') dispatch({ type: 'NO_ANSWER' });
    }, 45_000));
  } catch (e) {
    local?.getTracks().forEach((t) => t.stop());
    const reason = e instanceof CallFailure ? e.reason : 'failed';
    const id = useCall.getState().machine.callId;
    dispatch({ type: 'FAILED', reason });
    if (id) await rpcCall('end_call', { call_id: id, reason: 'failed' }).catch(() => {});
  }
}

export async function acceptIncoming() {
  const m = useCall.getState().machine;
  if (m.phase !== 'incoming' || !m.callId || !m.peerId || !m.kind || !myId) return;
  const { callId, peerId, kind } = m;
  let local: MediaStream;
  try {
    local = await getMedia(kind); // if this fails the call keeps ringing so the user can still decline
  } catch (e) {
    useCall.getState().patch({ notice: e instanceof CallFailure ? { permission_denied: 'Microphone or camera access was denied. Allow it in your browser settings, then accept again.', no_device: 'No microphone or camera was found.' }[e.reason as 'permission_denied' | 'no_device'] ?? 'Could not start your microphone or camera.' : null });
    return;
  }
  try {
    await rpcCall('answer_call', { call_id: callId });
  } catch {
    local.getTracks().forEach((t) => t.stop());
    dispatch({ type: 'REMOTE_CANCELLED' }); // expired or cancelled while we were deciding
    return;
  }
  if (phase() !== 'incoming') { local.getTracks().forEach((t) => t.stop()); return; } // cancelled during setup
  dispatch({ type: 'ACCEPT' });
  useCall.getState().patch({ notice: null });
  try {
    const s = await makePc(callId, peerId, 'callee', local);
    const existing = await fetchSignals(callId, myId).catch(() => []);
    for (const sig of [...existing, ...(pending.get(callId) ?? [])].sort((a, b) => a.id - b.id)) await applySignal(s, sig);
    pending.delete(callId);
    s.timers.push(window.setTimeout(() => { if (session === s && phase() === 'connecting') void failCall('timeout'); }, 25_000));
  } catch {
    local.getTracks().forEach((t) => t.stop());
    await failCall('failed');
  }
}

export async function declineIncoming() {
  const id = useCall.getState().machine.callId;
  dispatch({ type: 'DECLINE' });
  if (id) await rpcCall('reject_call', { call_id: id }).catch(() => {});
}

export async function hangUp() {
  const id = session?.callId ?? useCall.getState().machine.callId;
  dispatch({ type: 'HANGUP' });
  if (id) await rpcCall('end_call', { call_id: id, reason: 'hangup' }).catch(() => {});
}

export function toggleMute() {
  const s = session; if (!s) return;
  const next = !useCall.getState().muted;
  s.local.getAudioTracks().forEach((t) => { t.enabled = !next; });
  useCall.getState().patch({ muted: next });
}
export function toggleCamera() {
  const s = session; if (!s) return;
  const next = !useCall.getState().cameraOff;
  s.local.getVideoTracks().forEach((t) => { t.enabled = !next; });
  useCall.getState().patch({ cameraOff: next });
}

export async function switchDevice(kind: 'audioinput' | 'videoinput', deviceId: string) {
  const s = session; if (!s) return;
  const media = await navigator.mediaDevices.getUserMedia(kind === 'audioinput' ? { audio: { deviceId: { exact: deviceId } } } : { video: { deviceId: { exact: deviceId } } });
  const track = media.getTracks()[0];
  const sender = s.pc.getSenders().find((x) => x.track?.kind === track.kind);
  if (!sender) { track.stop(); return; }
  const old = sender.track;
  track.enabled = old?.enabled ?? true;
  await sender.replaceTrack(track);
  if (old) { s.local.removeTrack(old); old.stop(); }
  s.local.addTrack(track);
  useCall.getState().patch({ localStream: new MediaStream(s.local.getTracks()) });
}

// ── realtime call rows ──
export function onCallRow(row: CallRow, isInsert: boolean) {
  if (!myId) return;
  const m = useCall.getState().machine;
  if (isInsert) {
    const fresh = Date.now() - new Date(row.created_at).getTime() < 60_000;
    if (row.callee_id === myId && row.status === 'ringing' && fresh && !isBusy(m.phase)) {
      dispatch({ type: 'INCOMING', callId: row.id, peerId: row.caller_id, conversationId: row.conversation_id, kind: row.kind });
    }
    return;
  }
  if (m.callId !== row.id) return;
  const iAmCaller = row.caller_id === myId;
  switch (row.status) {
    case 'active': if (iAmCaller) dispatch({ type: 'REMOTE_ANSWERED' }); break;
    case 'rejected': if (iAmCaller) dispatch({ type: 'REMOTE_REJECTED' }); break;
    case 'cancelled': if (!iAmCaller) dispatch({ type: 'REMOTE_CANCELLED' }); break;
    case 'missed': dispatch({ type: 'NO_ANSWER' }); break;
    case 'ended': case 'failed': dispatch({ type: 'REMOTE_ENDED' }); break;
  }
}

/** After a page reload: close calls left open by a previous page, and surface a call that is still ringing. */
export async function recoverOnLoad(me: string) {
  myId = me;
  if (!supabase) return;
  const open = await fetchOpenCalls().catch(() => [] as CallRow[]);
  for (const c of open) {
    const age = Date.now() - new Date(c.created_at).getTime();
    if (c.status === 'active') await rpcCall('end_call', { call_id: c.id, reason: 'abandoned' }).catch(() => {});
    else if (c.callee_id === me && age < 60_000) onCallRow(c, true);
    else if (c.caller_id === me) await rpcCall('end_call', { call_id: c.id, reason: 'hangup' }).catch(() => {});
  }
}
export function setEngineUser(id: string | null) { myId = id; }
