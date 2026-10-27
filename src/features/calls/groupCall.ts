import {
  ConnectionState, Room, RoomEvent,
} from 'livekit-client';
import { supabase } from '@/lib/supabase';
import {
  endGroupCallRpc, joinGroupCallRpc, leaveGroupCallRpc, startGroupCallRpc, type GroupCall,
} from '@/features/chat/api';
import { useAuth } from '@/stores/auth';
import { useGroupCall } from './groupCallStore';

type TokenResponse = { url: string; token: string; roomName: string };
let activeRoom: Room | null = null;
let leaving = false;
let startedAt = 0;

const store = () => useGroupCall.getState();
const bump = () => useGroupCall.setState((s) => ({
  version: s.version + 1,
  muted: activeRoom ? !activeRoom.localParticipant.isMicrophoneEnabled : s.muted,
  cameraOff: activeRoom ? !activeRoom.localParticipant.isCameraEnabled : s.cameraOff,
  audioBlocked: activeRoom ? !activeRoom.canPlaybackAudio : s.audioBlocked,
}));

async function requestToken(callId: string): Promise<TokenResponse> {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('livekit-token', { body: { call_id: callId } });
  if (error) throw new Error('Group calling is not configured on this deployment. Ask the owner to deploy the livekit-token function and set the LiveKit secrets.');
  if (!data?.token || !data?.url) throw new Error('The media server did not return a usable token.');
  return data as TokenResponse;
}

function attachRoom(room: Room) {
  activeRoom = room;
  const bumpEvents: RoomEvent[] = [
    RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
    RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
    RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
    RoomEvent.ActiveSpeakersChanged, RoomEvent.AudioPlaybackStatusChanged,
    RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
  ];
  for (const ev of bumpEvents) room.on(ev, bump);
  room.on(RoomEvent.ConnectionStateChanged, (state) => {
    if (state === ConnectionState.Reconnecting) useGroupCall.setState({ status: 'reconnecting' });
    if (state === ConnectionState.Connected && store().status === 'reconnecting') useGroupCall.setState({ status: 'connected' });
  });
  room.on(RoomEvent.Reconnecting, () => useGroupCall.setState({ status: 'reconnecting' }));
  room.on(RoomEvent.Reconnected, () => { useGroupCall.setState({ status: 'connected' }); bump(); });
  room.on(RoomEvent.Disconnected, () => {
    if (leaving) return;
    useGroupCall.setState({ status: 'ended', room: null, error: 'The call ended or the connection was lost.' });
    activeRoom = null;
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, bump);
}

async function connect(call: GroupCall, isHost: boolean) {
  leaving = false;
  useGroupCall.setState({ status: 'connecting', call, error: null, canEnd: isHost, title: store().title, version: 0 });
  let room: Room | null = null;
  try {
    const info = await requestToken(call.id);
    room = new Room({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 24 } },
    });
    attachRoom(room);
    await room.connect(info.url, info.token);
    startedAt = Date.now();
    await room.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    if (call.kind === 'video') await room.localParticipant.setCameraEnabled(true).catch(() => {});
    await room.startAudio().catch(() => {});
    useGroupCall.setState({ status: 'connected', room, muted: !room.localParticipant.isMicrophoneEnabled, cameraOff: !room.localParticipant.isCameraEnabled, audioBlocked: !room.canPlaybackAudio });
    bump();
  } catch (e) {
    try { await room?.disconnect(); } catch { /* already closed */ }
    activeRoom = null;
    const message = e instanceof Error ? e.message : 'Could not join the group call.';
    useGroupCall.setState({ status: 'error', error: message, room: null });
  }
}

export async function startGroupCall(cid: string, kind: 'voice' | 'video', title: string) {
  if (store().status === 'connecting' || store().status === 'connected') return;
  useGroupCall.setState({ status: 'connecting', title, call: null, error: null });
  let call: GroupCall | null = null;
  try {
    call = await startGroupCallRpc(cid, kind);
    await connect(call, true);
    if (useGroupCall.getState().status === 'error') {
      await endGroupCallRpc(call.id).catch(() => {});
    }
  } catch (e) {
    useGroupCall.setState({ status: 'error', error: e instanceof Error ? e.message : 'Could not start the call.' });
    if (call) await endGroupCallRpc(call.id).catch(() => {});
  }
}

export async function joinGroupCall(call: GroupCall, title: string, canEnd: boolean) {
  useGroupCall.setState({ title });
  try {
    const joined = await joinGroupCallRpc(call.id);
    await connect(joined, canEnd || joined.started_by === useAuth.getState().session?.user.id);
  } catch (e) {
    useGroupCall.setState({ status: 'error', error: e instanceof Error ? e.message : 'Could not join the call.' });
  }
}

export function leaveGroupCall() {
  const call = store().call;
  leaving = true;
  activeRoom?.disconnect();
  activeRoom = null;
  if (call) void leaveGroupCallRpc(call.id).catch(() => {});
  useGroupCall.setState({ status: 'idle', call: null, room: null, error: null, canEnd: false, audioBlocked: false });
}

export async function endGroupCall() {
  const call = store().call;
  if (!call) return;
  await endGroupCallRpc(call.id).catch(() => {});
  leaving = true;
  activeRoom?.disconnect();
  activeRoom = null;
  useGroupCall.setState({ status: 'ended', call: null, room: null, error: null });
}

export async function toggleGroupMute() {
  const room = activeRoom;
  if (!room) return;
  const next = !room.localParticipant.isMicrophoneEnabled;
  await room.localParticipant.setMicrophoneEnabled(next);
  useGroupCall.setState({ muted: !next });
}

export async function toggleGroupCamera() {
  const room = activeRoom;
  if (!room) return;
  const next = !room.localParticipant.isCameraEnabled;
  await room.localParticipant.setCameraEnabled(next);
  useGroupCall.setState({ cameraOff: !next });
}

export async function switchGroupDevice(kind: 'audioinput' | 'videoinput', deviceId: string) {
  if (!activeRoom) return;
  await activeRoom.switchActiveDevice(kind, deviceId);
}

export async function enableGroupAudio() {
  if (!activeRoom) return;
  await activeRoom.startAudio().catch(() => {});
  useGroupCall.setState({ audioBlocked: !activeRoom.canPlaybackAudio });
}

export function groupCallElapsed(): number {
  return startedAt ? Date.now() - startedAt : 0;
}

export function dismissGroupCallNotice() {
  useGroupCall.setState({ status: 'idle', error: null, call: null, room: null, canEnd: false });
}
