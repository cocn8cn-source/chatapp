import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { RequireAuth } from './RequireAuth';
import { useAuth } from '@/stores/auth';

const tree = (
  <MemoryRouter initialEntries={['/app']}>
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route element={<RequireAuth />}><Route path="/app" element={<p>private page</p>} /></Route>
    </Routes>
  </MemoryRouter>
);

describe('RequireAuth', () => {
  it('redirects signed-out visitors to /login', () => {
    useAuth.setState({ session: null, ready: true });
    render(tree);
    expect(screen.getByText('login page')).toBeInTheDocument();
  });
  it('shows private routes to signed-in users', () => {
    useAuth.setState({ session: { user: { id: 'u1' } } as Session, ready: true });
    render(tree);
    expect(screen.getByText('private page')).toBeInTheDocument();
  });
});
