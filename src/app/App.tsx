import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { initAuth } from '@/stores/auth';
import { safeAppPath } from '@/features/auth/redirect';
import { router } from './router';

export function App() {
  useEffect(() => initAuth(), []);

  // Tapping a push notification while the app is already open: the service worker asks the
  // running app to navigate (instant, no reload). A cold start opens the URL directly instead.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: unknown } | null;
      if (data?.type === 'NOTIFICATION_CLICK') void router.navigate(safeAppPath(data.url));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
