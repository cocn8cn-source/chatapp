import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { AuthLoading } from './AuthLoading';
import { DEFAULT_APP_PATH } from './redirect';

/**
 * `/` is the installed app's start URL. Signed-in users land in their inbox; everyone else
 * sees the welcome page.
 */
export function HomeRoute({ children }: { children: ReactNode }) {
  const { session, ready } = useAuth();
  if (!ready) return <AuthLoading />;
  if (session) return <Navigate to={DEFAULT_APP_PATH} replace />;
  return <>{children}</>;
}

/** Any URL that matches nothing: inbox when signed in, welcome page otherwise. Never a dead end. */
export function UnknownRoute() {
  const { session, ready } = useAuth();
  if (!ready) return <AuthLoading />;
  return <Navigate to={session ? DEFAULT_APP_PATH : '/'} replace />;
}
