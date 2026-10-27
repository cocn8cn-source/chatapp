import { supabase } from '@/lib/supabase';
import type { CallKind } from './callMachine';

export type CallRow = {
  id: string; conversation_id: string; caller_id: string; callee_id: string; kind: CallKind;
  status: 'ringing' | 'active' | 'ended' | 'rejected' | 'missed' | 'cancelled' | 'failed';
  end_reason: string | null; created_at: string; answered_at: string | null; ended_at: string | null;
};
export type SignalRow = { id: number; call_id: string; from_user: string; to_user: string; kind: 'offer' | 'answer' | 'candidate'; payload: Record<string, unknown> };
export type CallHistoryItem = CallRow & {
  peer_id: string; peer_username: string; peer_display_name: string; peer_avatar_path: string | null;
};

function client() { if (!supabase) throw new Error('Supabase is not configured'); return supabase; }

export const callKeys = { history: ['calls', 'history'] as const };

export async function fetchCallHistory(): Promise<CallHistoryItem[]> {
  const { data, error } = await client().rpc('call_history', { lim: 50 });
  if (error) throw error;
  return (data ?? []) as CallHistoryItem[];
}

export async function fetchOpenCalls(): Promise<CallRow[]> {
  const { data, error } = await client().from('calls').select('*').in('status', ['ringing', 'active']);
  if (error) throw error;
  return (data ?? []) as CallRow[];
}

export async function rpcCall(name: 'start_call' | 'answer_call' | 'reject_call' | 'end_call' | 'expire_call', args: Record<string, unknown>): Promise<CallRow> {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data as CallRow;
}

export async function sendSignal(callId: string, toUser: string, kind: SignalRow['kind'], payload: unknown) {
  const { error } = await client().from('call_signals').insert({ call_id: callId, to_user: toUser, kind, payload });
  if (error) throw error;
}

export async function fetchSignals(callId: string, me: string): Promise<SignalRow[]> {
  const { data, error } = await client().from('call_signals').select('*').eq('call_id', callId).eq('to_user', me).order('id');
  if (error) throw error;
  return (data ?? []) as SignalRow[];
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
let iceCache: { at: number; servers: RTCIceServer[]; hasTurn: boolean } | null = null;
/** TURN credentials are minted per user by the `ice-servers` Edge Function; without it we fall back to public STUN. */
export async function getIceServers(): Promise<{ servers: RTCIceServer[]; hasTurn: boolean }> {
  if (iceCache && Date.now() - iceCache.at < 10 * 60_000) return iceCache;
  try {
    const { data, error } = await client().functions.invoke('ice-servers');
    if (error || !Array.isArray(data?.iceServers)) throw error ?? new Error('bad response');
    const servers = data.iceServers as RTCIceServer[];
    iceCache = { at: Date.now(), servers, hasTurn: servers.some((s) => JSON.stringify(s.urls).includes('turn')) };
  } catch {
    iceCache = { at: Date.now() - 9 * 60_000, servers: FALLBACK_ICE, hasTurn: false }; // retry soon
  }
  return iceCache;
}
