import { supabase } from '@/lib/supabase';

export type Visibility = 'everyone' | 'contacts' | 'nobody';

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  about: string;
  avatar_path: string | null;
  avatar_visibility?: Visibility;
  about_visibility?: Visibility;
  online_visibility?: Visibility;
  last_seen_visibility?: Visibility;
};

export type MyProfile = Profile & {
  read_receipts: boolean;
  notify_messages: boolean;
  notify_calls: boolean;
  notification_sound: boolean;
  auto_download_images: boolean;
  auto_download_videos: boolean;
  enter_to_send: boolean;
  reduced_motion: boolean;
  who_can_message: 'everyone' | 'contacts';
};

export type ConversationItem = {
  id: string;
  kind: 'direct' | 'group';
  title: string | null;
  description: string;
  photo_path: string | null;
  created_by: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  peer_id: string | null;
  peer_username: string | null;
  peer_display_name: string | null;
  peer_avatar_path: string | null;
  peer_last_read_at: string | null;
  peer_last_delivered_at: string | null;
  pinned_at: string | null;
  archived_at: string | null;
  muted_until: string | null;
  my_role: 'member' | 'admin';
  member_count: number;
  unread: number;
  blocked: boolean;
  blocked_by_peer: boolean;
};

export type MemberInfo = {
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  role: 'member' | 'admin';
  joined_at: string;
  is_contact: boolean;
  online_visible: boolean;
};

export type Attachment = {
  id?: string;
  kind: 'image' | 'video' | 'audio' | 'file';
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  duration_ms?: number | null;
  waveform?: number[] | null;
};

export type Reaction = { user_id: string; emoji: string };

export type ReplyPreview = {
  id: string; sender_id: string; body: string; deleted_at: string | null;
  /** Kinds only: enough to label an attachment-only message (voice note, photo, file). */
  attachments?: { kind: Attachment['kind'] }[] | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  reply_to_id?: string | null;
  forwarded?: boolean;
  attachments?: Attachment[];
  message_reactions?: Reaction[];
  message_stars?: { user_id: string }[];
  reply_to?: ReplyPreview | null;
  status?: 'pending' | 'failed';
};

export type SearchHit = Pick<Message, 'id' | 'conversation_id' | 'sender_id' | 'body' | 'created_at'>;

export type ProfileCard = {
  id: string;
  username: string;
  display_name: string;
  about: string;
  avatar_path: string | null;
  is_self: boolean;
  is_contact: boolean;
  blocked_by_me: boolean;
  blocked_me: boolean;
  contact_request_id: string | null;
  contact_request_status: 'pending' | 'accepted' | 'declined' | null;
  contact_request_from_me: boolean;
  accepts_messages: boolean;
};

export type DirectoryPerson = {
  id: string;
  username: string;
  display_name: string;
  about: string;
  avatar_path: string | null;
  is_contact: boolean;
  contact_request_id: string | null;
  contact_request_status: 'pending' | 'accepted' | 'declined' | null;
  contact_request_from_me: boolean;
};

export type ContactItem = {
  contact_id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  status: 'pending' | 'accepted' | 'declined';
  from_me: boolean;
  created_at: string;
};

export type BlockedPerson = { user_id: string; username: string; display_name: string; avatar_path: string | null; blocked_at: string };

export type GroupCall = {
  id: string;
  conversation_id: string;
  started_by: string;
  kind: 'voice' | 'video';
  room_name: string;
  status: 'active' | 'ended';
  created_at: string;
  ended_at: string | null;
};

export type GroupCallHistoryItem = {
  id: string;
  conversation_id: string;
  conversation_title: string;
  started_by: string;
  kind: 'voice' | 'video';
  status: 'active' | 'ended';
  created_at: string;
  ended_at: string | null;
  participant_count: number;
};

export const PAGE_SIZE = 30;

export const keys = {
  conversations: ['conversations'] as const,
  messages: (cid: string) => ['messages', cid] as const,
  profile: (uid: string) => ['profile', uid] as const,
  myProfile: ['my-profile'] as const,
  saved: ['saved-messages'] as const,
  search: (q: string) => ['search', q] as const,
  media: (cid: string) => ['media', cid] as const,
  usage: ['storage-usage'] as const,
  contacts: ['contacts'] as const,
  blocked: ['blocked-people'] as const,
  people: (q: string) => ['people', q] as const,
  profileCard: (uid: string) => ['profile-card', uid] as const,
  members: (cid: string) => ['members', cid] as const,
  pins: (cid: string) => ['pins', cid] as const,
  readCounts: (cid: string) => ['read-counts', cid] as const,
  activeGroupCall: (cid: string) => ['group-call', cid] as const,
  groupCalls: ['group-calls'] as const,
  notifications: ['notifications'] as const,
};

function client() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client().rpc(name, args);
  if (error) throw error;
  return data as T;
}

// ───────────────────────── profiles and people ─────────────────────────
export async function fetchMyProfile(): Promise<MyProfile> {
  const { data, error } = await client().rpc('my_profile').single();
  if (error) throw error;
  return data as unknown as MyProfile;
}

export async function updateMyProfile(patch: Partial<Pick<Profile, 'display_name' | 'username' | 'about' | 'avatar_path'> &
  Record<'avatar_visibility' | 'about_visibility' | 'online_visibility' | 'last_seen_visibility', Visibility>>) {
  const uid = (await client().auth.getUser()).data.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { error } = await client().from('profiles').update(patch).eq('id', uid);
  if (error) throw error;
}

export async function updateMySettings(patch: Partial<Omit<MyProfile, keyof Profile>>) {
  const uid = (await client().auth.getUser()).data.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { error } = await client().from('user_settings').update(patch).eq('user_id', uid);
  if (error) throw error;
}

export async function fetchProfileCard(uid: string): Promise<ProfileCard | null> {
  const { data, error } = await client().rpc('profile_card', { target: uid }).maybeSingle();
  if (error) throw error;
  return (data ?? null) as ProfileCard | null;
}

export async function searchPeople(q: string): Promise<DirectoryPerson[]> {
  return rpc<DirectoryPerson[]>('directory_people', { q });
}

export async function fetchContacts(): Promise<ContactItem[]> {
  return rpc<ContactItem[]>('my_contacts');
}

export async function sendContactRequest(username: string): Promise<string> {
  return rpc<string>('send_contact_request', { target_username: username.trim().replace(/^@/, '') });
}
export async function respondContactRequest(requestId: string, accept: boolean) {
  return rpc<void>('respond_contact_request', { request_id: requestId, accept });
}
export async function removeContact(userId: string) {
  return rpc<void>('remove_contact', { other_user: userId });
}
export async function fetchBlockedPeople(): Promise<BlockedPerson[]> {
  return rpc<BlockedPerson[]>('blocked_people');
}
export async function blockUser(userId: string) {
  return rpc<void>('block_user', { target: userId });
}
export async function unblockUser(userId: string) {
  return rpc<void>('unblock_user', { target: userId });
}
export async function reportUser(userId: string, reason: string, details: string) {
  return rpc<string>('report_user', { target: userId, reason, details });
}
export async function reportMessage(messageId: string, reason: string, details: string) {
  return rpc<string>('report_message', { mid: messageId, reason, details });
}

// ───────────────────────── conversations ─────────────────────────
export async function fetchConversations(): Promise<ConversationItem[]> {
  return rpc<ConversationItem[]>('my_conversations');
}

export async function startDirectChat(username: string): Promise<string> {
  const { data, error } = await client().rpc('start_direct_chat', { other_username: username.trim().replace(/^@/, '') });
  if (error) {
    if (error.code === 'P0002') throw new Error('No user with that username');
    throw new Error(error.message || 'Could not start the chat');
  }
  return data as string;
}

export async function fetchMembers(cid: string): Promise<MemberInfo[]> {
  return rpc<MemberInfo[]>('conversation_members_info', { cid });
}

export async function createGroup(title: string, description: string, memberIds: string[]): Promise<string> {
  return rpc<string>('create_group', { group_title: title, group_description: description, member_ids: memberIds });
}
export async function updateGroup(cid: string, title: string, description: string) {
  return rpc<void>('update_group', { cid, new_title: title, new_description: description });
}
export async function setGroupPhoto(cid: string, path: string | null) {
  return rpc<void>('set_group_photo', { cid, path });
}
export async function addGroupMembers(cid: string, ids: string[]): Promise<number> {
  return rpc<number>('add_group_members', { cid, new_members: ids });
}
export async function removeGroupMember(cid: string, userId: string) {
  return rpc<void>('remove_group_member', { cid, target: userId });
}
export async function setGroupMemberRole(cid: string, userId: string, makeAdmin: boolean) {
  return rpc<void>('set_group_member_role', { cid, target: userId, make_admin: makeAdmin });
}
export async function leaveGroup(cid: string) {
  return rpc<void>('leave_group', { cid });
}
export async function deleteGroup(cid: string) {
  return rpc<void>('delete_group', { cid });
}

export type ConversationPrefs = Partial<Pick<ConversationItem, 'pinned_at' | 'archived_at' | 'muted_until'>>;
export async function updatePrefs(cid: string, uid: string, patch: ConversationPrefs) {
  const { error } = await client().from('conversation_members').update(patch).eq('conversation_id', cid).eq('user_id', uid);
  if (error) throw error;
}
export async function markConversationUnread(cid: string) {
  return rpc<void>('mark_conversation_unread', { cid });
}
export async function clearConversation(cid: string) {
  return rpc<void>('clear_conversation', { cid });
}
export async function deleteConversationForMe(cid: string) {
  return rpc<void>('delete_conversation_for_me', { cid });
}

// ───────────────────────── messages ─────────────────────────
const ATT_COLS = 'id, kind, storage_path, file_name, mime_type, size_bytes, duration_ms, waveform';
const MSG_COLS = `id, conversation_id, sender_id, body, created_at, edited_at, deleted_at, reply_to_id, forwarded,
  attachments(${ATT_COLS}),
  message_reactions(user_id, emoji),
  message_stars(user_id)`;

type ReplyRow = { id: string; sender_id: string; body: string; deleted_at: string | null; attachments?: { kind: Attachment['kind'] }[] | null };

/**
 * Reply targets are looked up separately on purpose.
 *
 * PostgREST resolves the self-referencing `reply_to_id` relationship as one-to-many
 * (one message can have many replies), so `reply_to:messages!reply_to_id(...)`
 * returns `[]` for an ordinary message. An empty array is truthy, which rendered a
 * ghost reply quote — sender name plus “Attachment” — on every single bubble.
 */
async function withReplies(rows: Message[]): Promise<Message[]> {
  const ids = [...new Set(rows.map((m) => m.reply_to_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows.map((m) => ({ ...m, reply_to: null }));
  const { data, error } = await client().from('messages')
    .select('id, sender_id, body, deleted_at, attachments(kind)').in('id', ids);
  if (error) throw error;
  const byId = new Map(((data ?? []) as ReplyRow[]).map((r) => [r.id, r]));
  return rows.map((m) => ({ ...m, reply_to: m.reply_to_id ? byId.get(m.reply_to_id) ?? null : null }));
}

/** Newest-first page. `before` is the created_at of the oldest message already loaded. */
export async function fetchMessages(cid: string, before?: string): Promise<Message[]> {
  let q = client().from('messages').select(MSG_COLS)
    .eq('conversation_id', cid).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(PAGE_SIZE);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw error;
  return withReplies((data ?? []) as unknown as Message[]);
}

export async function fetchMessageById(id: string): Promise<Message | null> {
  const { data, error } = await client().from('messages').select(MSG_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [row] = await withReplies([data as unknown as Message]);
  return row ?? null;
}

export async function insertMessage(m: { id: string; conversation_id: string; body: string; reply_to_id?: string | null; forwarded?: boolean }) {
  const { error } = await client().from('messages').insert(m);
  // 23505 = same id already stored (a retry that actually succeeded) — treat as success
  if (error && error.code !== '23505') throw error;
}

export async function editMessage(id: string, body: string) {
  const { error } = await client().rpc('edit_message', { mid: id, new_body: body });
  if (error) throw error;
}
export async function deleteMessage(id: string) {
  const { error } = await client().rpc('delete_message', { mid: id });
  if (error) throw error;
}
export async function hideMessage(id: string) {
  const { error } = await client().from('message_hides').insert({ message_id: id });
  if (error && error.code !== '23505') throw error;
}
/**
 * 23505 = the row already exists, which is the result the caller wanted.
 *
 * Reaction, star and pin tables deliberately grant no UPDATE to clients, so an
 * upsert (`ON CONFLICT DO UPDATE`) is rejected with 42501 and the action silently
 * fails. Inserting and tolerating a duplicate keeps the same behaviour legally.
 */
function isDuplicate(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export async function setReaction(messageId: string, emoji: string, on: boolean) {
  if (on) {
    const { error } = await client().from('message_reactions').insert({ message_id: messageId, emoji });
    if (error && !isDuplicate(error)) throw error;
  } else {
    const uid = (await client().auth.getUser()).data.user?.id;
    if (!uid) throw new Error('Not signed in');
    const { error } = await client().from('message_reactions').delete()
      .eq('message_id', messageId).eq('user_id', uid).eq('emoji', emoji);
    if (error) throw error;
  }
}
export async function setStar(messageId: string, on: boolean) {
  const uid = (await client().auth.getUser()).data.user?.id;
  if (!uid) throw new Error('Not signed in');
  if (on) {
    const { error } = await client().from('message_stars').insert({ message_id: messageId });
    if (error && !isDuplicate(error)) throw error;
    return;
  }
  const { error } = await client().from('message_stars').delete().eq('message_id', messageId).eq('user_id', uid);
  if (error) throw error;
}
export async function setPinned(cid: string, messageId: string, on: boolean) {
  if (on) {
    const { error } = await client().from('pinned_messages').insert({ conversation_id: cid, message_id: messageId });
    if (error && !isDuplicate(error)) throw error;
  } else {
    const { error } = await client().from('pinned_messages').delete()
      .eq('conversation_id', cid).eq('message_id', messageId);
    if (error) throw error;
  }
}

export type PinnedItem = { message_id: string; created_at: string; messages: Message | null };
export async function fetchPinned(cid: string): Promise<PinnedItem[]> {
  const { data, error } = await client().from('pinned_messages')
    .select(`message_id, created_at, messages(${MSG_COLS})`)
    .eq('conversation_id', cid).order('created_at', { ascending: false }).limit(10);
  if (error) throw error;
  const rows = (data ?? []) as unknown as PinnedItem[];
  const hydrated = await withReplies(rows.map((r) => r.messages).filter((m): m is Message => !!m));
  const byId = new Map(hydrated.map((m) => [m.id, m]));
  return rows.map((r) => ({ ...r, messages: r.messages ? byId.get(r.messages.id) ?? r.messages : null }));
}

export type SavedItem = { message_id: string; created_at: string; messages: (Pick<Message, 'id' | 'conversation_id' | 'sender_id' | 'body' | 'created_at' | 'deleted_at'> & {
  attachments?: { kind: Attachment['kind'] }[];
  conversations: { id: string; title: string | null; kind: 'direct' | 'group' } | null;
}) | null };
export async function fetchSavedMessages(): Promise<SavedItem[]> {
  const { data, error } = await client().from('message_stars')
    .select('message_id, created_at, messages(id, conversation_id, sender_id, body, created_at, deleted_at, attachments(kind), conversations(id, title, kind))')
    .order('created_at', { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as SavedItem[];
}


export async function markRead(cid: string) {
  return rpc<void>('mark_conversation_read', { cid });
}
export async function markDelivered(cid: string) {
  return rpc<void>('mark_conversation_delivered', { cid });
}
export async function fetchReadCounts(cid: string): Promise<{ message_id: string; read_count: number | string }[]> {
  return rpc('message_read_counts', { cid });
}

export async function searchMessages(q: string, cid?: string): Promise<SearchHit[]> {
  const { data, error } = await client().rpc('search_messages', { q, cid: cid ?? null, lim: 20 });
  if (error) throw error;
  return (data ?? []) as SearchHit[];
}

/** Idempotent: re-inserting an already-stored attachment (retry) is ignored. */
export async function insertAttachments(cid: string, messageId: string, list: Attachment[]) {
  if (list.length === 0) return;
  const rows = list.map((a) => ({
    message_id: messageId, conversation_id: cid, kind: a.kind, storage_path: a.storage_path, file_name: a.file_name,
    mime_type: a.mime_type, size_bytes: a.size_bytes, duration_ms: a.duration_ms ?? null, waveform: a.waveform ?? null,
  }));
  const { error } = await client().from('attachments').upsert(rows, { onConflict: 'storage_path', ignoreDuplicates: true });
  if (error) throw error;
}

export type LinkSource = { id: string; body: string; created_at: string; sender_id: string };
/** Messages in this conversation that contain a link. RLS restricts rows to members. */
export async function fetchLinkSources(cid: string): Promise<LinkSource[]> {
  const { data, error } = await client().from('messages')
    .select('id, body, created_at, sender_id')
    .eq('conversation_id', cid)
    .ilike('body', '%http%')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as LinkSource[];
}

export type MediaItem = Attachment & { id: string; message_id: string; created_at: string };
export async function fetchMedia(cid: string): Promise<MediaItem[]> {
  const { data, error } = await client().from('attachments')
    .select(`${ATT_COLS}, message_id, created_at`).eq('conversation_id', cid).order('created_at', { ascending: false }).limit(60);
  if (error) throw error;
  return (data ?? []) as MediaItem[];
}

export async function fetchStorageUsage(): Promise<number> {
  const { data, error } = await client().rpc('my_storage_usage');
  if (error) throw error;
  return Number(data ?? 0);
}

// ───────────────────────── group calls ─────────────────────────
export async function fetchActiveGroupCall(cid: string): Promise<GroupCall | null> {
  const { data, error } = await client().from('group_calls').select('*')
    .eq('conversation_id', cid).eq('status', 'active').maybeSingle();
  if (error) throw error;
  return (data ?? null) as GroupCall | null;
}
export async function fetchGroupCallHistory(): Promise<GroupCallHistoryItem[]> {
  return rpc<GroupCallHistoryItem[]>('my_group_call_history', { lim: 30 });
}
export async function startGroupCallRpc(cid: string, kind: 'voice' | 'video'): Promise<GroupCall> {
  return rpc<GroupCall>('start_group_call', { cid, call_kind: kind });
}
export async function joinGroupCallRpc(callId: string): Promise<GroupCall> {
  return rpc<GroupCall>('join_group_call', { call_id: callId });
}
export async function leaveGroupCallRpc(callId: string) {
  return rpc<void>('leave_group_call', { call_id: callId });
}
export async function endGroupCallRpc(callId: string) {
  return rpc<void>('end_group_call', { call_id: callId });
}
