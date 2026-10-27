import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { AuthLoading } from './AuthLoading';
import { fromState } from './redirect';

/** Sign-in / sign-up / forgot-password: pointless when already signed in, so skip straight to the app. */
export function PublicOnly() {
  const { session, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <AuthLoading />;
  if (session) return <Navigate to={fromState(location.state)} replace />;
  return <Outlet />;
}
