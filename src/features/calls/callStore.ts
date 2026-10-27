import { create } from 'zustand';
import { callReducer, initialCall, type CallEvent, type CallState } from './callMachine';

type CallStore = {
  machine: CallState;
  localStream: MediaStream | null; remoteStream: MediaStream | null;
  muted: boolean; cameraOff: boolean; connectedAt: number | null; notice: string | null;
  dispatch: (e: CallEvent) => void;
  patch: (p: Partial<Omit<CallStore, 'machine' | 'dispatch' | 'patch'>>) => void;
};

export const useCall = create<CallStore>((set) => ({
  machine: initialCall, localStream: null, remoteStream: null, muted: false, cameraOff: false, connectedAt: null, notice: null,
  dispatch: (e) => set((s) => {
    const machine = callReducer(s.machine, e);
    if (machine === s.machine) return s;
    const connectedAt = machine.phase === 'connected' && !s.connectedAt ? Date.now() : machine.phase === 'idle' || machine.phase === 'outgoing' || machine.phase === 'incoming' ? null : s.connectedAt;
    return { machine, connectedAt };
  }),
  patch: (p) => set(p),
}));
