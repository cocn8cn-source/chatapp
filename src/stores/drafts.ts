import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type DraftState = {
  drafts: Record<string, string>;
  setDraft: (key: string, text: string) => void;
  clearDraft: (key: string) => void;
  clearAll: () => void;
};

/** Drafts are local-device convenience data, never uploaded until the message is sent. */
export const useDrafts = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      setDraft: (key, text) => set((s) => ({ drafts: { ...s.drafts, [key]: text } })),
      clearDraft: (key) => set((s) => {
        const drafts = { ...s.drafts };
        delete drafts[key];
        return { drafts };
      }),
      clearAll: () => set({ drafts: {} }),
    }),
    { name: 'chatspace-drafts', partialize: (s) => ({ drafts: s.drafts }) },
  ),
);
