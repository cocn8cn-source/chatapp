import { create } from 'zustand';

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;

type InstallState = {
  canInstall: boolean;
  installed: boolean;
  iosGuidance: boolean;
  init: () => () => void;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const usePwa = create<InstallState>((set) => ({
  canInstall: false,
  installed: isStandalone(),
  iosGuidance: typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent),
  init: () => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as BeforeInstallPromptEvent;
      set({ canInstall: true });
    };
    const onInstalled = () => { deferredPrompt = null; set({ canInstall: false, installed: true }); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (isStandalone()) set({ installed: true });
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  },
  promptInstall: async () => {
    if (!deferredPrompt) return 'unavailable';
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    set({ canInstall: false });
    return choice.outcome;
  },
}));
