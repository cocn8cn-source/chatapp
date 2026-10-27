import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
const KEY = 'chatspace-theme';

export function resolveTheme(pref: ThemePreference, prefersDark: boolean): 'light' | 'dark' {
  return pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref;
}

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch { return 'system'; }
}

function apply(pref: ThemePreference) {
  const dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(pref, dark);
}

type ThemeState = { preference: ThemePreference; setPreference: (p: ThemePreference) => void };

export const useTheme = create<ThemeState>((set) => ({
  preference: read(),
  setPreference: (preference) => {
    try { localStorage.setItem(KEY, preference); } catch { /* storage unavailable */ }
    apply(preference);
    set({ preference });
  },
}));
