import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { createChannel } from '@/lib/realtime';
import { useAuth } from '@/stores/auth';
import { callKeys, type CallRow, type SignalRow } from './api';
import { onCallRow, onSignal, recoverOnLoad, setEngineUser } from './callEngine';
import { CallOverlay } from './CallOverlay';

export function CallProvider() {
  const uid = useAuth((s) => s.session?.user.id);
  const qc = useQueryClient();

  useEffect(() => {
    if (!supabase || !uid) return;
    setEngineUser(uid);
    void recoverOnLoad(uid).then(() => qc.invalidateQueries({ queryKey: callKeys.history }));
    const row = (isInsert: boolean) => (p: { new: unknown }) => {
      onCallRow(p.new as CallRow, isInsert);
      void qc.invalidateQueries({ queryKey: callKeys.history });
    };
    const channel = createChannel(`calls:${uid}`);
    if (!channel) return;
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${uid}` }, row(true))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `callee_id=eq.${uid}` }, row(false))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls', filter: `caller_id=eq.${uid}` }, row(false))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_signals', filter: `to_user=eq.${uid}` }, (p) => onSignal(p.new as SignalRow))
      .subscribe();
    return () => { setEngineUser(null); void supabase!.removeChannel(channel); };
  }, [uid, qc]);

  return <CallOverlay />;
}
