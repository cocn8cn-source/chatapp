import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/stores/auth';

export function RequireAuth() {
  const { session, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <p role="status" style={{ padding: '2rem' }}>Loading…</p>;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}
