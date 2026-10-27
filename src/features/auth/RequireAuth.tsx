import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/stores/auth';
import { AuthLoading } from './AuthLoading';

/** Private area. Signed-out visitors go to /login and come back to the page they asked for. */
export function RequireAuth() {
  const { session, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <AuthLoading />;
  if (!session) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <Outlet />;
}
