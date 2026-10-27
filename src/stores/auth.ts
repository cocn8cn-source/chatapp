import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/queryClient';

type AuthState = { session: Session | null; ready: boolean };
export const useAuth = create<AuthState>(() => ({ session: null, ready: !supabase }));

/** Start once at app boot. Clears cached data whenever the signed-in user changes. */
export function initAuth(): () => void {
  if (!supabase) return () => {};
  let currentUser: string | null = null;
  const apply = (session: Session | null) => {
    const next = session?.user.id ?? null;
    if (next !== currentUser) { queryClient.clear(); currentUser = next; }
    useAuth.setState({ session, ready: true });
  };
  void supabase.auth.getSession().then(({ data }) => apply(data.session));
  const { data } = supabase.auth.onAuthStateChange((_e, session) => apply(session));
  return () => data.subscription.unsubscribe();
}
