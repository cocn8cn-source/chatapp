import { supabase } from '@/lib/supabase';

export type AppNotification = {
  id: string;
  user_id: string;
  kind: 'message' | 'call' | 'missed_call' | 'group_call' | 'contact_request' | 'system';
  conversation_id: string | null;
  message_id: string | null;
  call_id: string | null;
  group_call_id: string | null;
  contact_id: string | null;
  title: string;
  body: string;
  url: string;
  read_at: string | null;
  created_at: string;
};

function client() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await client().from('notifications')
    .select('*').order('created_at', { ascending: false }).limit(80);
  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function markNotificationRead(id: string) {
  const { error } = await client().from('notifications').update({ read_at: new Date().toISOString() })
    .eq('id', id).is('read_at', null);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { error } = await client().from('notifications').update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

export async function deleteNotification(id: string) {
  const { error } = await client().from('notifications').delete().eq('id', id);
  if (error) throw error;
}

export async function markConversationNotificationsRead(conversationId: string) {
  const { error } = await client().from('notifications').update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId).is('read_at', null);
  if (error) throw error;
}

export function safeNotificationUrl(url: string): string {
  if (!url.startsWith('/app/') || url.startsWith('//') || url.includes('://')) return '/app/chats';
  return url;
}
