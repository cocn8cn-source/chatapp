import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { RequireAuth } from './RequireAuth';
import { PublicOnly } from './PublicOnly';
import { HomeRoute, UnknownRoute } from './RootRedirects';
import { fromState, safeAppPath } from './redirect';
import { useAuth } from '@/stores/auth';

const signedIn = { user: { id: 'u1' } } as Session;
const signedOut = () => useAuth.setState({ session: null, ready: true });
const signIn = () => useAuth.setState({ session: signedIn, ready: true });

/** Same shape as src/app/router.tsx, with stub pages. */
function Where() { const l = useLocation(); return <p>at {l.pathname}{l.search}</p>; }
function LoginStub() { const l = useLocation(); return <p>login from={String((l.state as { from?: string } | null)?.from)}</p>; }
function app(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<HomeRoute><p>welcome page</p></HomeRoute>} />
        <Route element={<PublicOnly />}>
          <Route path="/login" element={<LoginStub />} />
          <Route path="/register" element={<p>register page</p>} />
        </Route>
        <Route path="/reset-password" element={<p>reset page</p>} />
        <Route element={<RequireAuth />}>
          <Route path="/app/chats" element={<Where />} />
          <Route path="/app/chats/:id" element={<Where />} />
          <Route path="/app/settings" element={<Where />} />
        </Route>
        <Route path="*" element={<UnknownRoute />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('routing', () => {
  it('signed-out: private URL → /login, remembering where they were going (incl. query)', () => {
    signedOut();
    render(app('/app/chats/abc?message=42'));
    expect(screen.getByText('login from=/app/chats/abc?message=42')).toBeInTheDocument();
  });
  it('signed-in: /login and /register skip straight to the inbox', () => {
    signIn();
    const { unmount } = render(app('/login'));
    expect(screen.getByText('at /app/chats')).toBeInTheDocument();
    unmount();
    render(app('/register'));
    expect(screen.getByText('at /app/chats')).toBeInTheDocument();
  });
  it('signed-in: the start URL "/" opens the inbox', () => {
    signIn();
    render(app('/'));
    expect(screen.getByText('at /app/chats')).toBeInTheDocument();
  });
  it('signed-out: the start URL "/" shows the welcome page', () => {
    signedOut();
    render(app('/'));
    expect(screen.getByText('welcome page')).toBeInTheDocument();
  });
  it('unknown URLs never dead-end: welcome when signed out, inbox when signed in', () => {
    signedOut();
    const { unmount } = render(app('/no/such/page'));
    expect(screen.getByText('welcome page')).toBeInTheDocument();
    unmount();
    signIn();
    render(app('/no/such/page'));
    expect(screen.getByText('at /app/chats')).toBeInTheDocument();
  });
  it('the password-reset page stays reachable while signed in (recovery links sign the user in first)', () => {
    signIn();
    render(app('/reset-password'));
    expect(screen.getByText('reset page')).toBeInTheDocument();
  });
  it('shows a loading state, not a wrong redirect, until the session is known', () => {
    useAuth.setState({ session: null, ready: false });
    render(app('/app/settings'));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });
});

describe('safeAppPath', () => {
  it('keeps in-app paths', () => {
    expect(safeAppPath('/app/chats/abc?message=1')).toBe('/app/chats/abc?message=1');
    expect(safeAppPath('/app/settings#notifications')).toBe('/app/settings#notifications');
  });
  it('rejects anything that could leave the app', () => {
    for (const bad of ['//evil.com', 'https://evil.com', '/app/../x://y', '/apple', '/login', '', undefined, null, 42, '/app\\evil', '/app//evil.com://x']) {
      expect(safeAppPath(bad)).toBe('/app/chats');
    }
  });
  it('fromState reads the RequireAuth state defensively', () => {
    expect(fromState({ from: '/app/calls' })).toBe('/app/calls');
    expect(fromState(null)).toBe('/app/chats');
    expect(fromState({ from: 'https://evil.com' })).toBe('/app/chats');
  });
});
