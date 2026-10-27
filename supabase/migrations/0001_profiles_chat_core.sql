-- ChatSpace core schema: profiles, conversations, members, messages. RLS on everything.
create extension if not exists pgcrypto;

-- ───────── profiles ─────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null check (char_length(display_name) between 1 and 50),
  about text not null default '' check (char_length(about) <= 140),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Any signed-in user can read profiles (needed for username discovery). Per-field privacy is Phase 6.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- No insert/delete policy: rows are created by trigger and removed by cascade from auth.users.

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), new.raw_user_meta_data->>'username')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

create function public.username_available(candidate text) returns boolean
language sql security definer stable set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(candidate));
$$;
grant execute on function public.username_available(text) to anon, authenticated;

-- ───────── conversations ─────────
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text,
  direct_key text unique,               -- "<smaller uuid>:<larger uuid>" prevents duplicate 1:1 chats
  created_by uuid references auth.users(id) on delete set null,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now()
);
alter table public.conversations enable row level security;

create table public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index conversation_members_user_idx on public.conversation_members (user_id);
alter table public.conversation_members enable row level security;

-- security definer avoids recursive RLS when policies check membership
create function public.is_member(cid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = cid and user_id = auth.uid());
$$;

create policy conversations_select on public.conversations for select to authenticated using (public.is_member(id));
create policy members_select on public.conversation_members for select to authenticated using (public.is_member(conversation_id));
create policy members_update_own on public.conversation_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- No client insert/delete on conversations or members: conversations are created via RPC below.

-- ───────── messages ─────────
create table public.messages (
  id uuid primary key,                  -- client-generated for optimistic reconciliation
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_conversation_page_idx on public.messages (conversation_id, created_at desc, id desc);
alter table public.messages enable row level security;

create policy messages_select on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_member(conversation_id));
-- No update/delete policies yet: editing and deletion are not implemented.

create function public.on_message_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at, last_message_preview = left(new.body, 80)
   where id = new.conversation_id;
  return new;
end $$;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.on_message_inserted();

-- ───────── start a direct chat (the only way to create one) ─────────
create function public.start_direct_chat(other_username text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); other uuid; key text; cid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select id into other from public.profiles where username = lower(other_username);
  if other is null then raise exception 'user not found' using errcode = 'P0002'; end if;
  if other = me then raise exception 'cannot chat with yourself'; end if;
  key := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  select id into cid from public.conversations where direct_key = key;
  if cid is null then
    insert into public.conversations (kind, direct_key, created_by) values ('direct', key, me) returning id into cid;
    insert into public.conversation_members (conversation_id, user_id) values (cid, me), (cid, other);
  end if;
  return cid;
end $$;
revoke all on function public.start_direct_chat(text) from public, anon;
grant execute on function public.start_direct_chat(text) to authenticated;

-- ───────── realtime (respects RLS) ─────────
alter publication supabase_realtime add table public.messages;

-- ───────── avatars (public bucket; objects are namespaced by user id) ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
