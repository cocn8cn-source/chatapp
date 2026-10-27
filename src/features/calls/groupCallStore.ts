import { create } from 'zustand';
import type { Room } from 'livekit-client';
import type { GroupCall } from '@/features/chat/api';

export type GroupCallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'ended';

type State = {
  status: GroupCallStatus;
  call: GroupCall | null;
  room: Room | null;
  title: string;
  error: string | null;
  canEnd: boolean;
  muted: boolean;
  cameraOff: boolean;
  audioBlocked: boolean;
  version: number;
};

export const useGroupCall = create<State>(() => ({
  status: 'idle', call: null, room: null, title: 'Group call', error: null, canEnd: false,
  muted: false, cameraOff: false, audioBlocked: false, version: 0,
}));
