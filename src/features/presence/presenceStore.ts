import { create } from 'zustand';
import type { PresenceEntry } from './presence';

type PresenceState = {
  byId: Record<string, PresenceEntry>;
  replaceAll: (entries: Record<string, PresenceEntry>) => void;
  setOnline: (userId: string, online: boolean, updatedAt: string) => void;
  setLastSeen: (userId: string, lastSeenAt: string) => void;
  clear: () => void;
};

export const usePresenceStore = create<PresenceState>((set) => ({
  byId: {},
  replaceAll: (byId) => set({ byId }),
  setOnline: (userId, online, updatedAt) => set((s) => ({
    byId: { ...s.byId, [userId]: { ...(s.byId[userId] ?? { last_seen_at: null }), online, updated_at: updatedAt } },
  })),
  setLastSeen: (userId, lastSeenAt) => set((s) => ({
    byId: {
      ...s.byId,
      [userId]: {
        online: s.byId[userId]?.online ?? false,
        updated_at: s.byId[userId]?.updated_at ?? new Date().toISOString(),
        last_seen_at: lastSeenAt,
      },
    },
  })),
  clear: () => set({ byId: {} }),
}));
