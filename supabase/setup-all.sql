-- ─────────────────────────────────────────────────────────────────────────────
-- ChatSpace — complete database setup. GENERATED FILE, DO NOT EDIT.
-- Regenerate with: npm run db:setup
--
-- DESTRUCTIVE: starts by dropping the `public` schema, so every ChatSpace row
-- (profiles, chats, messages, calls, reports) is deleted. Auth users and files in
-- storage survive. Use it on a development project only.
--
-- Paste this whole file into Supabase → SQL Editor and run it once. It is safe to
-- run again: it always starts from an empty schema, never from a partial install.
-- It ends by recreating profile rows for accounts that already existed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- ChatSpace — DEV-ONLY database reset.
--
-- DESTRUCTIVE: drops the whole `public` schema, which deletes every ChatSpace
-- table and all of its data (profiles, conversations, messages, attachments rows,
-- calls, reports). Storage buckets/objects and auth.users are NOT dropped.
--
-- Use it only on a throwaway development project when a migration failed
-- halfway and re-running it is not possible. Never run this on a database that
-- holds data you want to keep.
--
-- After running this, apply the migrations in order (0001 → 0006). Existing
-- accounts will have no profile row; either sign up again or run
-- supabase/backfill-profiles.sql.
-- ─────────────────────────────────────────────────────────────────────────────

-- Storage policies live in the `storage` schema, so dropping `public` does not
-- remove them and the migrations would fail re-creating them.
drop policy if exists avatars_insert_own on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
drop policy if exists avatars_delete_own on storage.objects;
drop policy if exists avatars_select_visible on storage.objects;
drop policy if exists chat_media_insert on storage.objects;
drop policy if exists chat_media_select on storage.objects;
drop policy if exists group_photos_select on storage.objects;
drop policy if exists group_photos_insert on storage.objects;
drop policy if exists group_photos_update on storage.objects;
drop policy if exists group_photos_delete on storage.objects;

-- Safety: this also drops any extension installed inside `public`. On a recent
-- Supabase project extensions live in the `extensions` schema, so nothing else is
-- affected. Check first if unsure:
--   select extname, extnamespace::regnamespace from pg_extension;
drop schema if exists public cascade;
create schema public;

-- Re-create the privileges a fresh Supabase project has on `public`.
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 0001_profiles_chat_core.sql
-- ═════════════════════════════════════════════════════════════════════════════

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


-- ═════════════════════════════════════════════════════════════════════════════
-- 0002_message_actions_and_organization.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0002: edit/delete messages, unread counts, per-conversation prefs, search. Also tightens 0001.

-- ── messages: edit + delete-for-everyone (soft delete; body is wiped server-side) ──
alter table public.messages add column edited_at timestamptz, add column deleted_at timestamptz;
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_check
  check (deleted_at is not null or char_length(body) between 1 and 4000);

-- Clients may only supply id, conversation_id, body on insert (no forged timestamps or flags).
revoke insert on public.messages from authenticated;
grant insert (id, conversation_id, body) on public.messages to authenticated;

create function public.edit_message(mid uuid, new_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if new_body is null or char_length(new_body) not between 1 and 4000 then raise exception 'invalid body'; end if;
  update public.messages set body = new_body, edited_at = now()
   where id = mid and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;

create function public.delete_message(mid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.messages set body = '', deleted_at = now()
   where id = mid and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
end $$;
revoke all on function public.edit_message(uuid, text), public.delete_message(uuid) from public, anon;
grant execute on function public.edit_message(uuid, text), public.delete_message(uuid) to authenticated;

-- keep the conversation preview in sync so deleted text never lingers there
create function public.on_message_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_preview = case when new.deleted_at is not null then 'Message deleted' else left(new.body, 80) end
   where id = new.conversation_id and last_message_at = new.created_at;
  return new;
end $$;
create trigger messages_after_update after update of body, deleted_at on public.messages
  for each row execute function public.on_message_updated();

-- ── per-conversation preferences live on the member row ──
alter table public.conversation_members
  add column pinned_at timestamptz, add column archived_at timestamptz, add column muted_until timestamptz;
-- Fix for 0001: members could previously update their own `role`. Restrict to these columns only.
revoke update on public.conversation_members from authenticated;
grant update (last_read_at, pinned_at, archived_at, muted_until) on public.conversation_members to authenticated;

-- ── unread counts (RLS applies: security invoker) ──
create function public.unread_counts() returns table (conversation_id uuid, unread bigint)
language sql stable as $$
  select m.conversation_id, count(*)
    from public.conversation_members cm
    join public.messages m on m.conversation_id = cm.conversation_id
     and m.created_at > cm.last_read_at and m.sender_id <> cm.user_id and m.deleted_at is null
   where cm.user_id = auth.uid()
   group by m.conversation_id;
$$;

-- ── search (RLS applies, so only conversations the caller belongs to are searched) ──
create extension if not exists pg_trgm;
create index messages_body_trgm on public.messages using gin (body gin_trgm_ops) where deleted_at is null;

create function public.search_messages(q text, cid uuid default null, lim int default 20)
returns table (id uuid, conversation_id uuid, sender_id uuid, body text, created_at timestamptz)
language sql stable as $$
  select m.id, m.conversation_id, m.sender_id, m.body, m.created_at
    from public.messages m
   where m.deleted_at is null
     and char_length(trim(q)) >= 2
     and (cid is null or m.conversation_id = cid)
     and m.body ilike '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   order by m.created_at desc
   limit least(coalesce(lim, 20), 50);
$$;

-- read receipts need other members' last_read_at → stream member updates too
alter publication supabase_realtime add table public.conversation_members;


-- ═════════════════════════════════════════════════════════════════════════════
-- 0003_attachments_and_voice.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0003: private media storage, attachments table, voice-note metadata, per-user quota.

-- Messages may carry only attachments (empty caption). Client still blocks fully empty sends.
alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_check
  check (deleted_at is not null or char_length(body) between 0 and 4000);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'audio', 'file')),
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 3600000),
  waveform jsonb check (waveform is null or (jsonb_typeof(waveform) = 'array' and jsonb_array_length(waveform) <= 128)),
  created_at timestamptz not null default now(),
  check (
    (kind = 'image' and mime_type like 'image/%') or (kind = 'video' and mime_type like 'video/%') or
    (kind = 'audio' and mime_type like 'audio/%') or kind = 'file'
  )
);
create index attachments_message_idx on public.attachments (message_id);
create index attachments_conversation_idx on public.attachments (conversation_id, created_at desc);
create index attachments_uploader_idx on public.attachments (uploader_id);
alter table public.attachments enable row level security;

-- readable only by members, and never after the message was deleted for everyone
create policy attachments_select on public.attachments for select to authenticated using (
  public.is_member(conversation_id)
  and exists (select 1 from public.messages m where m.id = attachments.message_id and m.deleted_at is null)
);
create policy attachments_insert on public.attachments for insert to authenticated with check (
  uploader_id = auth.uid() and public.is_member(conversation_id)
  and storage_path like conversation_id::text || '/' || message_id::text || '/%'
  and exists (select 1 from public.messages m
               where m.id = attachments.message_id and m.conversation_id = attachments.conversation_id
                 and m.sender_id = auth.uid() and m.deleted_at is null)
);
revoke insert on public.attachments from authenticated;
grant insert (message_id, conversation_id, kind, storage_path, file_name, mime_type, size_bytes, duration_ms, waveform)
  on public.attachments to authenticated;
-- no update/delete policies: attachments are immutable once sent

-- storage quota (500 MB per uploader, counting every attachment ever sent)
create function public.enforce_media_quota() returns trigger
language plpgsql security definer set search_path = public as $$
declare used bigint;
begin
  select coalesce(sum(size_bytes), 0) into used from public.attachments where uploader_id = new.uploader_id;
  if used + new.size_bytes > 524288000 then raise exception 'storage quota exceeded' using errcode = '53400'; end if;
  return new;
end $$;
create trigger attachments_quota before insert on public.attachments
  for each row execute function public.enforce_media_quota();

create function public.my_storage_usage() returns bigint
language sql stable as $$ select coalesce(sum(size_bytes), 0)::bigint from public.attachments where uploader_id = auth.uid(); $$;

-- ── private bucket + object policies ──
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (
  'chat-media', 'chat-media', false, 26214400,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
        'audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','application/pdf','text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation']
) on conflict (id) do nothing;

-- upload: first path segment must be a conversation the caller belongs to
create function public.can_upload_media(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_member(split_part(object_name, '/', 1)::uuid);
exception when others then return false;
end $$;

-- read: only via an attachment row of a non-deleted message in a conversation the caller belongs to
create function public.can_read_media(object_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.attachments a join public.messages m on m.id = a.message_id
     where a.storage_path = object_name and m.deleted_at is null and public.is_member(a.conversation_id));
$$;

create policy chat_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and public.can_upload_media(name));
create policy chat_media_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and public.can_read_media(name));

alter publication supabase_realtime add table public.attachments;


-- ═════════════════════════════════════════════════════════════════════════════
-- 0004_calls.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0004: 1:1 voice/video calls. All state changes go through RPCs that lock the row,
-- so simultaneous events (answer vs. cancel vs. timeout) cannot leave an inconsistent state.

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('voice', 'video')),
  status text not null default 'ringing'
    check (status in ('ringing', 'active', 'ended', 'rejected', 'missed', 'cancelled', 'failed')),
  end_reason text,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  check (caller_id <> callee_id)
);
create index calls_caller_idx on public.calls (caller_id, created_at desc);
create index calls_callee_idx on public.calls (callee_id, created_at desc);
create index calls_open_idx on public.calls (status) where status in ('ringing', 'active');
alter table public.calls enable row level security;

create policy calls_select on public.calls for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());
-- no insert/update/delete policies: RPCs only

-- signaling messages (SDP + ICE). Only the two call participants can write or read them.
create table public.call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  from_user uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'candidate')),
  payload jsonb not null check (pg_column_size(payload) < 16384),
  created_at timestamptz not null default now()
);
create index call_signals_call_idx on public.call_signals (call_id, id);
create index call_signals_to_idx on public.call_signals (to_user, id);
alter table public.call_signals enable row level security;

create policy signals_select on public.call_signals for select to authenticated
  using (to_user = auth.uid() or from_user = auth.uid());
create policy signals_insert on public.call_signals for insert to authenticated with check (
  from_user = auth.uid()
  and exists (select 1 from public.calls c where c.id = call_signals.call_id and c.status in ('ringing', 'active')
              and ((c.caller_id = auth.uid() and c.callee_id = call_signals.to_user)
                or (c.callee_id = auth.uid() and c.caller_id = call_signals.to_user)))
);
revoke insert on public.call_signals from authenticated;
grant insert (call_id, to_user, kind, payload) on public.call_signals to authenticated;

-- signals are useless after a call ends
create function public.drop_signals_when_done() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status not in ('ringing', 'active') then delete from public.call_signals where call_id = new.id; end if;
  return new;
end $$;
create trigger calls_cleanup after update of status on public.calls
  for each row execute function public.drop_signals_when_done();

-- ── state transitions ──
-- ringing → active | rejected | missed | cancelled | failed ; active → ended | failed ; terminal states never change.

create function public.start_call(cid uuid, call_kind text) returns public.calls
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); other uuid; c public.calls;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if call_kind not in ('voice', 'video') then raise exception 'invalid kind'; end if;
  if not exists (select 1 from public.conversations where id = cid and kind = 'direct') then raise exception 'not a direct conversation'; end if;
  if not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  select user_id into other from public.conversation_members where conversation_id = cid and user_id <> me;
  if other is null then raise exception 'no other participant'; end if;

  perform pg_advisory_xact_lock(hashtext(least(me::text, other::text) || greatest(me::text, other::text)));
  -- expire stale ringing calls and abandoned active ones first
  update public.calls set status = 'missed', ended_at = now(), end_reason = 'timeout'
   where status = 'ringing' and created_at < now() - interval '60 seconds' and (caller_id in (me, other) or callee_id in (me, other));
  update public.calls set status = 'ended', ended_at = now(), end_reason = 'abandoned'
   where status = 'active' and answered_at < now() - interval '4 hours' and (caller_id in (me, other) or callee_id in (me, other));

  if exists (select 1 from public.calls where status in ('ringing', 'active')
              and (caller_id in (me, other) or callee_id in (me, other))) then
    raise exception 'busy' using errcode = 'P0001';
  end if;
  insert into public.calls (conversation_id, caller_id, callee_id, kind) values (cid, me, other, call_kind) returning * into c;
  return c;
end $$;

create function public.answer_call(call_id uuid) returns public.calls
language plpgsql security definer set search_path = public as $$
declare c public.calls;
begin
  select * into c from public.calls where id = call_id and callee_id = auth.uid() for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.status = 'ringing' and c.created_at < now() - interval '60 seconds' then
    update public.calls set status = 'missed', ended_at = now(), end_reason = 'timeout' where id = c.id returning * into c;
    raise exception 'expired' using errcode = 'P0001';
  end if;
  if c.status = 'ringing' then
    update public.calls set status = 'active', answered_at = now() where id = c.id returning * into c;
  elsif c.status <> 'active' then
    raise exception 'expired' using errcode = 'P0001';
  end if;
  return c;
end $$;

create function public.reject_call(call_id uuid) returns public.calls
language plpgsql security definer set search_path = public as $$
declare c public.calls;
begin
  select * into c from public.calls where id = call_id and callee_id = auth.uid() for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.status = 'ringing' then
    update public.calls set status = 'rejected', ended_at = now(), end_reason = 'declined' where id = c.id returning * into c;
  end if;
  return c;
end $$;

-- hang up: caller while ringing → cancelled; either side while active → ended (or failed). Idempotent.
create function public.end_call(call_id uuid, reason text default 'hangup') returns public.calls
language plpgsql security definer set search_path = public as $$
declare c public.calls; me uuid := auth.uid();
begin
  select * into c from public.calls where id = call_id and (caller_id = me or callee_id = me) for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  reason := left(coalesce(reason, 'hangup'), 40);
  if c.status = 'ringing' then
    if c.caller_id = me then
      update public.calls set status = 'cancelled', ended_at = now(), end_reason = reason where id = c.id returning * into c;
    else
      update public.calls set status = 'rejected', ended_at = now(), end_reason = 'declined' where id = c.id returning * into c;
    end if;
  elsif c.status = 'active' then
    update public.calls set status = case when reason in ('failed', 'timeout') then 'failed' else 'ended' end,
           ended_at = now(), end_reason = reason where id = c.id returning * into c;
  end if;
  return c;
end $$;

-- no-answer timeout, callable by either participant
create function public.expire_call(call_id uuid) returns public.calls
language plpgsql security definer set search_path = public as $$
declare c public.calls; me uuid := auth.uid();
begin
  select * into c from public.calls where id = call_id and (caller_id = me or callee_id = me) for update;
  if not found then raise exception 'not allowed' using errcode = '42501'; end if;
  if c.status = 'ringing' and c.created_at < now() - interval '40 seconds' then
    update public.calls set status = 'missed', ended_at = now(), end_reason = 'timeout' where id = c.id returning * into c;
  end if;
  return c;
end $$;

revoke all on function public.start_call(uuid, text), public.answer_call(uuid), public.reject_call(uuid),
  public.end_call(uuid, text), public.expire_call(uuid) from public, anon;
grant execute on function public.start_call(uuid, text), public.answer_call(uuid), public.reject_call(uuid),
  public.end_call(uuid, text), public.expire_call(uuid) to authenticated;

alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.call_signals;


-- ═════════════════════════════════════════════════════════════════════════════
-- 0005_privacy_social_message_actions.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0005: privacy, contacts, blocking, reporting, presence, typing, message actions,
-- read receipts, saved/pinned messages, hidden messages and clear/delete-for-me.
-- Everything exposed is protected by RLS; state changes that need invariants live in RPCs.

-- ───────────────────────── profiles: privacy fields ─────────────────────────
alter table public.profiles
  add column avatar_visibility text not null default 'everyone'
    check (avatar_visibility in ('everyone', 'contacts', 'nobody')),
  add column about_visibility text not null default 'everyone'
    check (about_visibility in ('everyone', 'contacts', 'nobody')),
  add column online_visibility text not null default 'everyone'
    check (online_visibility in ('everyone', 'contacts', 'nobody')),
  add column last_seen_visibility text not null default 'everyone'
    check (last_seen_visibility in ('everyone', 'contacts', 'nobody'));

-- Column privileges are the real per-field enforcement. The base table can only be
-- read through RPCs that mask avatar/about according to the owner's settings.
revoke all on public.profiles from anon, authenticated;
grant select (id, username, display_name, created_at, updated_at) on public.profiles to authenticated;
grant update (username, display_name, about, avatar_path, avatar_visibility, about_visibility,
  online_visibility, last_seen_visibility) on public.profiles to authenticated;

-- ───────────────────────── user settings ─────────────────────────
create table public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  read_receipts boolean not null default true,
  notify_messages boolean not null default true,
  notify_calls boolean not null default true,
  notification_sound boolean not null default true,
  auto_download_images boolean not null default true,
  auto_download_videos boolean not null default false,
  enter_to_send boolean not null default true,
  reduced_motion boolean not null default false,
  who_can_message text not null default 'everyone' check (who_can_message in ('everyone', 'contacts')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy settings_select_own on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy settings_update_own on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.user_settings from anon, authenticated;
grant select on public.user_settings to authenticated;
grant update (read_receipts, notify_messages, notify_calls, notification_sound, auto_download_images,
  auto_download_videos, enter_to_send, reduced_motion, who_can_message) on public.user_settings to authenticated;

create trigger settings_touch before update on public.user_settings
  for each row execute function public.touch_updated_at();

create function public.handle_new_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end $$;
create trigger profiles_create_settings after insert on public.profiles
  for each row execute function public.handle_new_settings();
insert into public.user_settings (user_id) select id from public.profiles on conflict (user_id) do nothing;

-- ───────────────────────── contacts ─────────────────────────
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
create unique index contacts_pair_uidx on public.contacts (
  least(requester_id, addressee_id), greatest(requester_id, addressee_id)
);
create index contacts_addressee_idx on public.contacts (addressee_id, status);
create index contacts_requester_idx on public.contacts (requester_id, status);
alter table public.contacts enable row level security;
create policy contacts_select_involved on public.contacts for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
-- No write policies: requests are validated in the RPCs below.

-- ───────────────────────── blocks ─────────────────────────
create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);
alter table public.blocks enable row level security;
create policy blocks_select_own on public.blocks for select to authenticated using (blocker_id = auth.uid());
-- No write policies: block_user/unblock_user RPCs only.

-- ───────────────────────── reports ─────────────────────────
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reported_user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  reason text not null check (char_length(reason) between 2 and 60),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'actioned')),
  created_at timestamptz not null default now()
);
create index reports_reporter_idx on public.reports (reporter_id, created_at desc);
alter table public.reports enable row level security;
create policy reports_select_own on public.reports for select to authenticated using (reporter_id = auth.uid());
-- No write policies: report_user/report_message RPCs only.

-- ───────────────────────── relationship helpers ─────────────────────────
create function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.blocks
     where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create function public.is_contact(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contacts
     where status = 'accepted'
       and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a))
  );
$$;

create function public.shares_conversation(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members x
      join public.conversation_members y on y.conversation_id = x.conversation_id
     where x.user_id = a and y.user_id = b
  );
$$;

create function public.can_see_receipts(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select target = auth.uid()
    or coalesce((select s.read_receipts from public.user_settings s where s.user_id = target), true);
$$;

create function public.can_view_avatar(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when target = auth.uid() then true
    when public.is_blocked(auth.uid(), target) then false
    else coalesce((
      select case p.avatar_visibility
        when 'everyone' then true
        when 'contacts' then public.is_contact(auth.uid(), target) or public.shares_conversation(auth.uid(), target)
        else false
      end from public.profiles p where p.id = target), false)
  end;
$$;

create function public.can_view_about(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when target = auth.uid() then true
    when public.is_blocked(auth.uid(), target) then false
    else coalesce((
      select case p.about_visibility
        when 'everyone' then true
        when 'contacts' then public.is_contact(auth.uid(), target) or public.shares_conversation(auth.uid(), target)
        else false
      end from public.profiles p where p.id = target), false)
  end;
$$;

create function public.can_view_online(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when target = auth.uid() then true
    when public.is_blocked(auth.uid(), target) then false
    else coalesce((
      select case p.online_visibility
        when 'everyone' then true
        when 'contacts' then public.is_contact(auth.uid(), target) or public.shares_conversation(auth.uid(), target)
        else false
      end from public.profiles p where p.id = target), false)
  end;
$$;

create function public.can_view_last_seen(target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when target = auth.uid() then true
    when public.is_blocked(auth.uid(), target) then false
    else coalesce((
      select case p.last_seen_visibility
        when 'everyone' then true
        when 'contacts' then public.is_contact(auth.uid(), target) or public.shares_conversation(auth.uid(), target)
        else false
      end from public.profiles p where p.id = target), false)
  end;
$$;

create function public.can_access_message(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.messages m
     where m.id = mid and public.is_member(m.conversation_id)
  );
$$;

-- ─────────────────── private profile photos (real visibility enforcement) ───────────────────
update storage.buckets set public = false where id = 'avatars';

create function public.can_view_avatar_path(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.can_view_avatar(split_part(object_name, '/', 1)::uuid);
exception when others then
  return false;
end $$;

drop policy if exists avatars_select_visible on storage.objects;
create policy avatars_select_visible on storage.objects for select to authenticated using (
  bucket_id = 'avatars' and public.can_view_avatar_path(name)
);

-- ───────────────────────── read state ─────────────────────────
-- Kept separate from conversation_members so a member's last-read time is only
-- visible to others when they have read receipts enabled.
create table public.conversation_reads (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_delivered_at timestamptz not null default now(),
  cleared_before timestamptz,
  deleted_at timestamptz,
  primary key (conversation_id, user_id)
);
create index conversation_reads_user_idx on public.conversation_reads (user_id);
alter table public.conversation_reads enable row level security;
create policy reads_select_own_or_allowed on public.conversation_reads for select to authenticated using (
  user_id = auth.uid()
  or (public.is_member(conversation_id) and public.can_see_receipts(user_id))
);
revoke all on public.conversation_reads from anon, authenticated;
grant select on public.conversation_reads to authenticated;

insert into public.conversation_reads (conversation_id, user_id, last_read_at, last_delivered_at)
select conversation_id, user_id, last_read_at, last_read_at
  from public.conversation_members
on conflict (conversation_id, user_id) do nothing;

create function public.create_read_state() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.conversation_reads (conversation_id, user_id)
  values (new.conversation_id, new.user_id)
  on conflict (conversation_id, user_id) do nothing;
  return new;
end $$;
create trigger members_create_read_state after insert on public.conversation_members
  for each row execute function public.create_read_state();

-- Read state is no longer updated or streamed through conversation_members.
revoke update on public.conversation_members from authenticated;
grant update (pinned_at, archived_at, muted_until) on public.conversation_members to authenticated;
drop policy if exists members_select on public.conversation_members;
create policy members_select_own on public.conversation_members for select to authenticated using (user_id = auth.uid());
revoke select on public.conversation_members from authenticated;
grant select (conversation_id, user_id, role, joined_at, pinned_at, archived_at, muted_until)
  on public.conversation_members to authenticated;
alter publication supabase_realtime drop table public.conversation_members;
alter publication supabase_realtime add table public.conversation_reads;

-- Recompute unread from the new table (security invoker keeps RLS on messages).
drop function if exists public.unread_counts();
create function public.unread_counts() returns table (conversation_id uuid, unread bigint)
language sql stable as $$
  select cm.conversation_id, count(*)::bigint
    from public.conversation_members cm
    join public.conversation_reads r on r.conversation_id = cm.conversation_id and r.user_id = cm.user_id
    join public.messages m on m.conversation_id = cm.conversation_id
     and m.created_at > r.last_read_at and m.sender_id <> cm.user_id and m.deleted_at is null
     and m.created_at > coalesce(r.cleared_before, 'epoch'::timestamptz)
   where cm.user_id = auth.uid()
   group by cm.conversation_id;
$$;

-- ───────────────────────── message actions ─────────────────────────
alter table public.messages
  add column reply_to_id uuid references public.messages(id) on delete set null,
  add column forwarded boolean not null default false;
create index messages_reply_idx on public.messages (reply_to_id);

grant insert (reply_to_id, forwarded) on public.messages to authenticated;

create table public.message_hides (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_hides enable row level security;
create policy hides_select_own on public.message_hides for select to authenticated using (user_id = auth.uid());
create policy hides_insert_own on public.message_hides for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_message(message_id));
create policy hides_delete_own on public.message_hides for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.message_hides to authenticated;

create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index message_reactions_message_idx on public.message_reactions (message_id);
alter table public.message_reactions enable row level security;
create policy reactions_select_member on public.message_reactions for select to authenticated
  using (public.can_access_message(message_id));
create policy reactions_insert_own on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_message(message_id));
create policy reactions_delete_own on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());
revoke all on public.message_reactions from anon, authenticated;
grant select, insert, delete on public.message_reactions to authenticated;

create table public.pinned_messages (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid not null unique references public.messages(id) on delete cascade,
  pinned_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, message_id)
);
create index pinned_messages_conversation_idx on public.pinned_messages (conversation_id, created_at desc);
alter table public.pinned_messages enable row level security;
create policy pins_select_member on public.pinned_messages for select to authenticated
  using (public.is_member(conversation_id));
create policy pins_insert_member on public.pinned_messages for insert to authenticated with check (
  pinned_by = auth.uid() and public.is_member(conversation_id)
  and exists (select 1 from public.messages m where m.id = message_id and m.conversation_id = pinned_messages.conversation_id)
);
create policy pins_delete_member on public.pinned_messages for delete to authenticated
  using (public.is_member(conversation_id));
revoke all on public.pinned_messages from anon, authenticated;
grant select, insert, delete on public.pinned_messages to authenticated;

create table public.message_stars (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_stars enable row level security;
create policy stars_select_own on public.message_stars for select to authenticated using (user_id = auth.uid());
create policy stars_insert_own on public.message_stars for insert to authenticated
  with check (user_id = auth.uid() and public.can_access_message(message_id));
create policy stars_delete_own on public.message_stars for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.message_stars to authenticated;

-- Per-message receipts power group read counts. Inserted automatically for every
-- member other than the sender; updated only through the read RPCs.
create table public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);
create index message_receipts_message_idx on public.message_receipts (message_id);
alter table public.message_receipts enable row level security;
create policy receipts_select_allowed on public.message_receipts for select to authenticated using (
  public.can_access_message(message_id)
  and (user_id = auth.uid() or public.can_see_receipts(user_id))
);
revoke all on public.message_receipts from anon, authenticated;
grant select on public.message_receipts to authenticated;

create function public.seed_message_receipts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.message_receipts (message_id, user_id)
  select new.id, cm.user_id from public.conversation_members cm
   where cm.conversation_id = new.conversation_id and cm.user_id <> new.sender_id
  on conflict (message_id, user_id) do nothing;
  return new;
end $$;
create trigger messages_seed_receipts after insert on public.messages
  for each row execute function public.seed_message_receipts();

-- Read receipts respect the reader's privacy switch when read by someone else.
create function public.mark_conversation_read(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  update public.conversation_reads
     set last_read_at = now(), last_delivered_at = now()
   where conversation_id = cid and user_id = me;
  update public.message_receipts r
     set read_at = now(), delivered_at = coalesce(r.delivered_at, now())
    from public.messages m
   where m.id = r.message_id and m.conversation_id = cid and m.sender_id <> me
     and r.user_id = me and r.read_at is null;
  update public.conversation_members set last_read_at = now()
   where conversation_id = cid and user_id = me;
end $$;

create function public.mark_conversation_delivered(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  update public.conversation_reads set last_delivered_at = now()
   where conversation_id = cid and user_id = me;
  update public.message_receipts r
     set delivered_at = now()
    from public.messages m
   where m.id = r.message_id and m.conversation_id = cid and m.sender_id <> me
     and r.user_id = me and r.delivered_at is null;
end $$;

create function public.clear_conversation(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  update public.conversation_reads set cleared_before = now(), last_read_at = now()
   where conversation_id = cid and user_id = auth.uid();
end $$;

create function public.delete_conversation_for_me(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  update public.conversation_reads set deleted_at = now()
   where conversation_id = cid and user_id = auth.uid();
end $$;

create function public.unread_for_conversation(cid uuid) returns bigint
language sql stable security invoker as $$
  select count(*)::bigint
    from public.messages m
    join public.conversation_reads r on r.conversation_id = m.conversation_id and r.user_id = auth.uid()
   where m.conversation_id = cid and m.sender_id <> auth.uid() and m.deleted_at is null
     and m.created_at > r.last_read_at and m.created_at > coalesce(r.cleared_before, 'epoch'::timestamptz);
$$;

create function public.message_read_counts(cid uuid) returns table (message_id uuid, read_count bigint)
language sql stable as $$
  select r.message_id, count(*)::bigint
    from public.message_receipts r
    join public.messages m on m.id = r.message_id
   where m.conversation_id = cid and r.read_at is not null and r.user_id <> auth.uid()
   group by r.message_id;
$$;

-- ───────────────────────── message visibility + rules ─────────────────────────
create function public.can_see_message(mid uuid, cid uuid, created_at timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(cid)
    and not exists (select 1 from public.message_hides h where h.message_id = mid and h.user_id = auth.uid())
    and created_at > coalesce((select r.cleared_before from public.conversation_reads r
                                where r.conversation_id = cid and r.user_id = auth.uid()), 'epoch'::timestamptz)
    and created_at > coalesce((select r.deleted_at from public.conversation_reads r
                                where r.conversation_id = cid and r.user_id = auth.uid()), 'epoch'::timestamptz);
$$;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.can_see_message(id, conversation_id, created_at));

create function public.enforce_message_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); peer uuid; recent int;
begin
  if me is null then return new; end if; -- service-role maintenance inserts

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then raise exception 'reply target is not in this conversation' using errcode = '22023'; end if;

  select count(*) into recent from public.messages
   where sender_id = me and created_at > now() - interval '60 seconds';
  if recent >= 60 then raise exception 'Slow down a little and try again.' using errcode = '53400'; end if;

  if exists (select 1 from public.conversations c where c.id = new.conversation_id and c.kind = 'direct') then
    select user_id into peer from public.conversation_members
     where conversation_id = new.conversation_id and user_id <> me limit 1;
    if peer is not null and public.is_blocked(me, peer) then
      raise exception 'Messaging is unavailable in this conversation' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger messages_enforce_rules before insert on public.messages
  for each row execute function public.enforce_message_rules();

create function public.on_message_inserted_v2() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = case
           when new.deleted_at is not null then 'Message deleted'
           when char_length(new.body) = 0 and exists (select 1 from public.attachments a where a.message_id = new.id) then 'Attachment'
           else left(new.body, 80) end
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages
  for each row execute function public.on_message_inserted_v2();

-- ───────────────────────── typing indicators ─────────────────────────
create table public.typing_indicators (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.typing_indicators enable row level security;
create policy typing_select_member on public.typing_indicators for select to authenticated
  using (public.is_member(conversation_id));
create policy typing_write_own on public.typing_indicators for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(conversation_id));
create policy typing_update_own on public.typing_indicators for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member(conversation_id));
create policy typing_delete_own on public.typing_indicators for delete to authenticated using (user_id = auth.uid());
revoke all on public.typing_indicators from anon, authenticated;
grant select, insert, update, delete on public.typing_indicators to authenticated;
alter publication supabase_realtime add table public.typing_indicators;

-- ───────────────────────── presence ─────────────────────────
create table public.user_online (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  online boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.user_online enable row level security;
create policy online_select_allowed on public.user_online for select to authenticated
  using (public.can_view_online(user_id));
revoke all on public.user_online from anon, authenticated;
grant select on public.user_online to authenticated;

create table public.user_last_seen (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.user_last_seen enable row level security;
create policy last_seen_select_allowed on public.user_last_seen for select to authenticated
  using (public.can_view_last_seen(user_id));
revoke all on public.user_last_seen from anon, authenticated;
grant select on public.user_last_seen to authenticated;

create function public.presence_heartbeat() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into public.user_online (user_id, online, updated_at) values (me, true, now())
    on conflict (user_id) do update set online = true, updated_at = now();
  insert into public.user_last_seen (user_id, last_seen_at) values (me, now())
    on conflict (user_id) do update set last_seen_at = now();
end $$;

create function public.presence_offline() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then return; end if;
  insert into public.user_online (user_id, online, updated_at) values (me, false, now())
    on conflict (user_id) do update set online = false, updated_at = now();
  insert into public.user_last_seen (user_id, last_seen_at) values (me, now())
    on conflict (user_id) do update set last_seen_at = now();
end $$;

alter publication supabase_realtime add table public.user_online;
alter publication supabase_realtime add table public.user_last_seen;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.pinned_messages;
alter publication supabase_realtime add table public.contacts;

-- ───────────────────────── group metadata ─────────────────────────
-- 0006 adds these for group chats, but my_conversations() below already returns them.
-- Declaring them here (and with IF NOT EXISTS in 0006) keeps both files runnable in order.
alter table public.conversations
  add column if not exists description text not null default '' check (char_length(description) <= 280),
  add column if not exists photo_path text;

-- ───────────────────────── safe profile reads ─────────────────────────
create function public.my_profile()
returns table (
  id uuid, username text, display_name text, about text, avatar_path text,
  avatar_visibility text, about_visibility text, online_visibility text, last_seen_visibility text,
  read_receipts boolean, notify_messages boolean, notify_calls boolean, notification_sound boolean,
  auto_download_images boolean, auto_download_videos boolean, enter_to_send boolean,
  reduced_motion boolean, who_can_message text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name, p.about, p.avatar_path,
         p.avatar_visibility, p.about_visibility, p.online_visibility, p.last_seen_visibility,
         coalesce(s.read_receipts, true), coalesce(s.notify_messages, true), coalesce(s.notify_calls, true),
         coalesce(s.notification_sound, true), coalesce(s.auto_download_images, true),
         coalesce(s.auto_download_videos, false), coalesce(s.enter_to_send, true),
         coalesce(s.reduced_motion, false), coalesce(s.who_can_message, 'everyone')
    from public.profiles p
    left join public.user_settings s on s.user_id = p.id
   where p.id = auth.uid();
$$;

create function public.profile_card(target uuid)
returns table (
  id uuid, username text, display_name text, about text, avatar_path text,
  is_self boolean, is_contact boolean, blocked_by_me boolean, blocked_me boolean,
  contact_request_id uuid, contact_request_status text, contact_request_from_me boolean,
  accepts_messages boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name,
         case when public.can_view_about(p.id) then p.about else '' end,
         case when public.can_view_avatar(p.id) then p.avatar_path else null end,
         p.id = auth.uid(),
         public.is_contact(auth.uid(), p.id),
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = p.id),
         exists (select 1 from public.blocks b where b.blocker_id = p.id and b.blocked_id = auth.uid()),
         r.id, r.status, r.requester_id = auth.uid(),
         case
           when coalesce(s.who_can_message, 'everyone') = 'everyone' then true
           else public.is_contact(auth.uid(), p.id) end
    from public.profiles p
    left join public.user_settings s on s.user_id = p.id
    left join lateral (
      select c.id, c.status, c.requester_id from public.contacts c
       where (c.requester_id = auth.uid() and c.addressee_id = p.id)
          or (c.addressee_id = auth.uid() and c.requester_id = p.id)
       limit 1
    ) r on true
   where p.id = target and auth.uid() is not null;
$$;

create function public.directory_people(q text)
returns table (
  id uuid, username text, display_name text, about text, avatar_path text,
  is_contact boolean, contact_request_id uuid, contact_request_status text, contact_request_from_me boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name,
         case when public.can_view_about(p.id) then p.about else '' end,
         case when public.can_view_avatar(p.id) then p.avatar_path else null end,
         public.is_contact(auth.uid(), p.id), r.id, r.status, r.requester_id = auth.uid()
    from public.profiles p
    left join lateral (
      select c.id, c.status, c.requester_id from public.contacts c
       where (c.requester_id = auth.uid() and c.addressee_id = p.id)
          or (c.addressee_id = auth.uid() and c.requester_id = p.id)
       limit 1
    ) r on true
   where auth.uid() is not null
     and char_length(trim(q)) >= 1
     and p.id <> auth.uid()
     and not public.is_blocked(auth.uid(), p.id)
     and (p.username ilike '%' || trim(q) || '%' or p.display_name ilike '%' || trim(q) || '%')
   order by p.username
   limit 20;
$$;

create function public.my_contacts()
returns table (
  contact_id uuid, user_id uuid, username text, display_name text, avatar_path text,
  status text, from_me boolean, created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select c.id,
         case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end,
         p.username, p.display_name,
         case when public.can_view_avatar(p.id) then p.avatar_path else null end,
         c.status, c.requester_id = auth.uid(), c.created_at
    from public.contacts c
    join public.profiles p on p.id = case when c.requester_id = auth.uid() then c.addressee_id else c.requester_id end
   where c.requester_id = auth.uid() or c.addressee_id = auth.uid()
   order by c.status, p.display_name;
$$;

create function public.blocked_people()
returns table (user_id uuid, username text, display_name text, avatar_path text, blocked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name,
         case when public.can_view_avatar(p.id) then p.avatar_path else null end, b.created_at
    from public.blocks b join public.profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;

create function public.my_conversations()
returns table (
  id uuid, kind text, title text, description text, photo_path text, created_by uuid,
  last_message_at timestamptz, last_message_preview text,
  peer_id uuid, peer_username text, peer_display_name text, peer_avatar_path text,
  peer_last_read_at timestamptz, peer_last_delivered_at timestamptz,
  pinned_at timestamptz, archived_at timestamptz, muted_until timestamptz,
  my_role text, member_count integer, unread bigint,
  blocked boolean, blocked_by_peer boolean
)
language sql stable security definer set search_path = public as $$
  select c.id, c.kind, c.title, c.description, c.photo_path, c.created_by,
         c.last_message_at, c.last_message_preview,
         peer.id, peer.username, peer.display_name, peer.avatar_path,
         case when peer.id is not null and public.can_see_receipts(peer.id) then pr.last_read_at end,
         case when peer.id is not null and public.can_see_receipts(peer.id) then pr.last_delivered_at end,
         cm.pinned_at, cm.archived_at, cm.muted_until, cm.role,
         (select count(*)::int from public.conversation_members x where x.conversation_id = c.id),
         (select count(*)::bigint from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.deleted_at is null
             and m.created_at > coalesce(mine.last_read_at, 'epoch'::timestamptz)
             and m.created_at > coalesce(mine.cleared_before, 'epoch'::timestamptz)
             and not exists (select 1 from public.message_hides h where h.message_id = m.id and h.user_id = auth.uid())),
         exists (select 1 from public.blocks b where b.blocker_id = auth.uid() and b.blocked_id = peer.id),
         exists (select 1 from public.blocks b where b.blocker_id = peer.id and b.blocked_id = auth.uid())
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    join public.conversation_reads mine on mine.conversation_id = c.id and mine.user_id = auth.uid()
    left join lateral (
      select p.id, p.username, p.display_name,
             case when public.can_view_avatar(p.id) then p.avatar_path else null end as avatar_path
        from public.conversation_members om join public.profiles p on p.id = om.user_id
       where om.conversation_id = c.id and om.user_id <> auth.uid()
       limit 1
    ) peer on true
    left join public.conversation_reads pr on pr.conversation_id = c.id and pr.user_id = peer.id
   where cm.user_id = auth.uid()
     and (mine.deleted_at is null or coalesce(c.last_message_at, c.created_at) > mine.deleted_at)
   order by cm.pinned_at desc nulls last, c.last_message_at desc nulls last, c.created_at desc;
$$;

create function public.conversation_members_info(cid uuid)
returns table (
  user_id uuid, username text, display_name text, avatar_path text, role text,
  joined_at timestamptz, is_contact boolean, online_visible boolean
)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, p.display_name,
         case when public.can_view_avatar(p.id) then p.avatar_path else null end,
         cm.role, cm.joined_at, public.is_contact(auth.uid(), p.id),
         public.can_view_online(p.id)
    from public.conversation_members cm join public.profiles p on p.id = cm.user_id
   where cm.conversation_id = cid and public.is_member(cid)
   order by cm.role desc, p.display_name;
$$;

-- ───────────────────────── contacts / blocks / reports RPCs ─────────────────────────
create function public.send_contact_request(target_username text) returns uuid
language plpgsql security definer set search_path = public as $$

declare me uuid := auth.uid(); target uuid; existing public.contacts; rid uuid; sent int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select id into target from public.profiles where username = lower(trim(target_username));
  if target is null then raise exception 'user not found' using errcode = 'P0002'; end if;
  if target = me then raise exception 'cannot add yourself'; end if;
  if public.is_blocked(me, target) then raise exception 'not available' using errcode = '42501'; end if;
  select count(*) into sent from public.contacts
   where requester_id = me and created_at > now() - interval '24 hours';
  if sent >= 20 then raise exception 'Too many contact requests today. Try again tomorrow.' using errcode = '53400'; end if;
  select * into existing from public.contacts
   where (requester_id = me and addressee_id = target) or (requester_id = target and addressee_id = me)
   limit 1;
  if existing.id is not null then
    if existing.status = 'pending' and existing.addressee_id = me then
      update public.contacts set status = 'accepted', responded_at = now() where id = existing.id;
      return existing.id;
    end if;
    raise exception 'A contact request already exists' using errcode = '23505';
  end if;
  insert into public.contacts (requester_id, addressee_id) values (me, target) returning id into rid;
  return rid;
end $$;

create function public.respond_contact_request(request_id uuid, accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.contacts
     set status = case when accept then 'accepted' else 'declined' end, responded_at = now()
   where id = request_id and addressee_id = auth.uid() and status = 'pending';
  if not found then raise exception 'request not found' using errcode = '42501'; end if;
end $$;

create function public.remove_contact(other_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.contacts
   where (requester_id = auth.uid() and addressee_id = other_user)
      or (addressee_id = auth.uid() and requester_id = other_user);
$$;

create function public.block_user(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if target = auth.uid() then raise exception 'cannot block yourself'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), target) on conflict do nothing;
  delete from public.contacts
   where (requester_id = auth.uid() and addressee_id = target) or (addressee_id = auth.uid() and requester_id = target);
end $$;

create function public.unblock_user(target uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.blocks where blocker_id = auth.uid() and blocked_id = target;
$$;

create function public.report_user(target uuid, reason text, details text default '') returns uuid
language plpgsql security definer set search_path = public as $$

declare rid uuid; count_recent int;
begin
  if target = auth.uid() then raise exception 'cannot report yourself'; end if;
  select count(*) into count_recent from public.reports
   where reporter_id = auth.uid() and created_at > now() - interval '24 hours';
  if count_recent >= 10 then raise exception 'Too many reports today. Try again tomorrow.' using errcode = '53400'; end if;
  insert into public.reports (reported_user_id, reason, details)
  values (target, left(trim(reason), 60), left(coalesce(details, ''), 1000)) returning id into rid;
  return rid;
end $$;

create function public.report_message(mid uuid, reason text, details text default '') returns uuid
language plpgsql security definer set search_path = public as $$

declare m public.messages; rid uuid; count_recent int;
begin
  if not public.can_access_message(mid) then raise exception 'message not found' using errcode = '42501'; end if;
  select * into m from public.messages where id = mid;
  select count(*) into count_recent from public.reports
   where reporter_id = auth.uid() and created_at > now() - interval '24 hours';
  if count_recent >= 10 then raise exception 'Too many reports today. Try again tomorrow.' using errcode = '53400'; end if;
  insert into public.reports (reported_user_id, message_id, conversation_id, reason, details)
  values (m.sender_id, m.id, m.conversation_id, left(trim(reason), 60), left(coalesce(details, ''), 1000))
  returning id into rid;
  return rid;
end $$;

-- Replace 1:1 creation so blocks and message privacy settings are enforced server-side.
create or replace function public.start_direct_chat(other_username text) returns uuid
language plpgsql security definer set search_path = public as $$

declare me uuid := auth.uid(); other uuid; key text; cid uuid; policy text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select id into other from public.profiles where username = lower(trim(other_username));
  if other is null then raise exception 'user not found' using errcode = 'P0002'; end if;
  if other = me then raise exception 'cannot chat with yourself'; end if;
  if public.is_blocked(me, other) then raise exception 'Messaging is unavailable with this person.' using errcode = '42501'; end if;
  select c.id into cid from public.conversations c where c.direct_key = least(me::text, other::text) || ':' || greatest(me::text, other::text);
  if cid is not null then return cid; end if;
  select who_can_message into policy from public.user_settings where user_id = other;
  if coalesce(policy, 'everyone') = 'contacts' and not public.is_contact(me, other) then
    raise exception 'This person only accepts messages from contacts.' using errcode = '42501';
  end if;
  key := least(me::text, other::text) || ':' || greatest(me::text, other::text);
  insert into public.conversations (kind, direct_key, created_by) values ('direct', key, me) returning id into cid;
  insert into public.conversation_members (conversation_id, user_id) values (cid, me), (cid, other);
  return cid;
end $$;

revoke all on function public.my_profile(), public.profile_card(uuid), public.directory_people(text),
  public.my_contacts(), public.blocked_people(), public.my_conversations(), public.conversation_members_info(uuid),
  public.send_contact_request(text), public.respond_contact_request(uuid, boolean), public.remove_contact(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.report_user(uuid, text, text),
  public.report_message(uuid, text, text), public.mark_conversation_read(uuid),
  public.mark_conversation_delivered(uuid), public.clear_conversation(uuid), public.delete_conversation_for_me(uuid),
  public.presence_heartbeat(), public.presence_offline(), public.message_read_counts(uuid),
  public.unread_for_conversation(uuid) from public, anon;

grant execute on function public.my_profile(), public.profile_card(uuid), public.directory_people(text),
  public.my_contacts(), public.blocked_people(), public.my_conversations(), public.conversation_members_info(uuid),
  public.send_contact_request(text), public.respond_contact_request(uuid, boolean), public.remove_contact(uuid),
  public.block_user(uuid), public.unblock_user(uuid), public.report_user(uuid, text, text),
  public.report_message(uuid, text, text), public.mark_conversation_read(uuid),
  public.mark_conversation_delivered(uuid), public.clear_conversation(uuid), public.delete_conversation_for_me(uuid),
  public.presence_heartbeat(), public.presence_offline(), public.message_read_counts(uuid),
  public.unread_for_conversation(uuid) to authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- 0006_groups_notifications_calls.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- 0006: group chats and group calls, notifications, push subscriptions, call history.
-- Group membership changes and group-call state changes are RPC-only.

-- ───────────────────────── group metadata ─────────────────────────
-- Already declared in 0005 because my_conversations() returns them; IF NOT EXISTS keeps
-- this file runnable both after 0005 and on its own against a 0001-0004 database.
alter table public.conversations
  add column if not exists description text not null default '' check (char_length(description) <= 280),
  add column if not exists photo_path text;
create index conversations_group_idx on public.conversations (kind) where kind = 'group';

create function public.is_group_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversation_members
     where conversation_id = cid and user_id = auth.uid() and role = 'admin'
  );
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values (
  'group-photos', 'group-photos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']
) on conflict (id) do nothing;

create function public.is_group_photo_member(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_member(split_part(object_name, '/', 1)::uuid);
exception when others then
  return false;
end $$;
create function public.is_group_photo_admin(object_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return public.is_group_admin(split_part(object_name, '/', 1)::uuid);
exception when others then
  return false;
end $$;

create policy group_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'group-photos' and public.is_group_photo_member(name));
create policy group_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'group-photos' and public.is_group_photo_admin(name));
create policy group_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'group-photos' and public.is_group_photo_admin(name));
create policy group_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'group-photos' and public.is_group_photo_admin(name));

-- ───────────────────────── group RPCs ─────────────────────────
create function public.create_group(group_title text, group_description text, member_ids uuid[] default '{}')
returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid; clean_ids uuid[]; created int;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if char_length(trim(group_title)) not between 1 and 80 then raise exception 'Group name must be 1–80 characters'; end if;
  if char_length(coalesce(group_description, '')) > 280 then raise exception 'Description is too long'; end if;
  select count(*) into created from public.conversations
   where created_by = me and kind = 'group' and created_at > now() - interval '24 hours';
  if created >= 10 then raise exception 'You have created too many groups today' using errcode = '53400'; end if;

  select coalesce(array_agg(distinct x), '{}') into clean_ids
    from unnest(coalesce(member_ids, '{}')) x
   where x <> me
     and exists (select 1 from public.profiles p where p.id = x)
     and public.is_contact(me, x)
     and not public.is_blocked(me, x);
  if coalesce(array_length(clean_ids, 1), 0) > 49 then raise exception 'A group can have at most 50 members'; end if;

  insert into public.conversations (kind, title, description, created_by)
  values ('group', trim(group_title), left(coalesce(group_description, ''), 280), me)
  returning id into cid;
  insert into public.conversation_members (conversation_id, user_id, role) values (cid, me, 'admin');
  if coalesce(array_length(clean_ids, 1), 0) > 0 then
    insert into public.conversation_members (conversation_id, user_id, role)
    select cid, x, 'member' from unnest(clean_ids) x;
  end if;
  return cid;
end $$;

create function public.update_group(cid uuid, new_title text, new_description text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(cid) then raise exception 'only admins can edit the group' using errcode = '42501'; end if;
  if char_length(trim(new_title)) not between 1 and 80 then raise exception 'Group name must be 1–80 characters'; end if;
  if char_length(coalesce(new_description, '')) > 280 then raise exception 'Description is too long'; end if;
  update public.conversations set title = trim(new_title), description = left(coalesce(new_description, ''), 280)
   where id = cid and kind = 'group';
end $$;

create function public.set_group_photo(cid uuid, path text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(cid) then raise exception 'only admins can change the group photo' using errcode = '42501'; end if;
  if path is not null and path not like cid::text || '/%' then raise exception 'invalid photo path'; end if;
  update public.conversations set photo_path = path where id = cid and kind = 'group';
end $$;

create function public.add_group_members(cid uuid, new_members uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); ids uuid[]; current_count int; added int := 0;
begin
  if not public.is_group_admin(cid) then raise exception 'only admins can add members' using errcode = '42501'; end if;
  select count(*) into current_count from public.conversation_members where conversation_id = cid;
  select coalesce(array_agg(distinct x), '{}') into ids
    from unnest(coalesce(new_members, '{}')) x
   where x <> me and public.is_contact(me, x) and not public.is_blocked(me, x)
     and exists (select 1 from public.profiles p where p.id = x)
     and not exists (select 1 from public.conversation_members m where m.conversation_id = cid and m.user_id = x);
  if current_count + coalesce(array_length(ids, 1), 0) > 50 then raise exception 'A group can have at most 50 members'; end if;
  if coalesce(array_length(ids, 1), 0) = 0 then return 0; end if;
  insert into public.conversation_members (conversation_id, user_id, role)
  select cid, x, 'member' from unnest(ids) x;
  get diagnostics added = row_count;
  return added;
end $$;

create function public.remove_group_member(cid uuid, target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare admins int;
begin
  if not public.is_group_admin(cid) then raise exception 'only admins can remove members' using errcode = '42501'; end if;
  if target = auth.uid() then perform public.leave_group(cid); return; end if;
  if exists (select 1 from public.conversation_members where conversation_id = cid and user_id = target and role = 'admin') then
    select count(*) into admins from public.conversation_members where conversation_id = cid and role = 'admin';
    if admins <= 1 then raise exception 'Promote another admin first'; end if;
  end if;
  delete from public.conversation_members where conversation_id = cid and user_id = target;
end $$;

create function public.set_group_member_role(cid uuid, target uuid, make_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare admins int;
begin
  if not public.is_group_admin(cid) then raise exception 'only admins can change roles' using errcode = '42501'; end if;
  if not make_admin then
    select count(*) into admins from public.conversation_members where conversation_id = cid and role = 'admin';
    if admins <= 1 and exists (select 1 from public.conversation_members where conversation_id = cid and user_id = target and role = 'admin') then
      raise exception 'Every group needs an admin';
    end if;
  end if;
  update public.conversation_members set role = case when make_admin then 'admin' else 'member' end
   where conversation_id = cid and user_id = target;
end $$;

create function public.leave_group(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); remaining int; was_admin boolean; next_admin uuid;
begin
  if not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  select role = 'admin' into was_admin from public.conversation_members where conversation_id = cid and user_id = me;
  delete from public.conversation_members where conversation_id = cid and user_id = me;
  delete from public.typing_indicators where conversation_id = cid and user_id = me;
  select count(*) into remaining from public.conversation_members where conversation_id = cid;
  if remaining = 0 then
    delete from public.conversations where id = cid;
    return;
  end if;
  if was_admin and not exists (select 1 from public.conversation_members where conversation_id = cid and role = 'admin') then
    select user_id into next_admin from public.conversation_members where conversation_id = cid order by joined_at limit 1;
    update public.conversation_members set role = 'admin' where conversation_id = cid and user_id = next_admin;
  end if;
end $$;

create function public.delete_group(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(cid) then raise exception 'only admins can delete the group' using errcode = '42501'; end if;
  delete from public.conversations where id = cid and kind = 'group';
end $$;

-- ───────────────────────── group calls ─────────────────────────
create table public.group_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  started_by uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('voice', 'video')),
  room_name text not null unique,
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index group_calls_one_active_idx on public.group_calls (conversation_id) where status = 'active';
create index group_calls_conversation_idx on public.group_calls (conversation_id, created_at desc);
alter table public.group_calls enable row level security;
create policy group_calls_select_member on public.group_calls for select to authenticated
  using (public.is_member(conversation_id));
revoke all on public.group_calls from anon, authenticated;
grant select on public.group_calls to authenticated;

create table public.group_call_participants (
  group_call_id uuid not null references public.group_calls(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_call_id, user_id)
);
alter table public.group_call_participants enable row level security;
create policy group_call_participants_select on public.group_call_participants for select to authenticated
  using (exists (
    select 1 from public.group_calls gc
     where gc.id = group_call_participants.group_call_id and public.is_member(gc.conversation_id)
  ));
revoke all on public.group_call_participants from anon, authenticated;
grant select on public.group_call_participants to authenticated;

create function public.start_group_call(cid uuid, call_kind text) returns public.group_calls
language plpgsql security definer set search_path = public as $$
declare c public.group_calls;
begin
  if not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  if call_kind not in ('voice', 'video') then raise exception 'invalid call kind'; end if;
  if not exists (select 1 from public.conversations where id = cid and kind = 'group') then
    raise exception 'not a group conversation';
  end if;
  update public.group_calls set status = 'ended', ended_at = now()
   where conversation_id = cid and status = 'active' and created_at < now() - interval '6 hours';
  if exists (select 1 from public.group_calls where conversation_id = cid and status = 'active') then
    raise exception 'A group call is already in progress' using errcode = 'P0001';
  end if;
  insert into public.group_calls (conversation_id, started_by, kind, room_name)
  values (cid, auth.uid(), call_kind, 'group-' || gen_random_uuid()::text)
  returning * into c;
  insert into public.group_call_participants (group_call_id, user_id) values (c.id, auth.uid())
    on conflict do nothing;
  return c;
end $$;

create function public.join_group_call(call_id uuid) returns public.group_calls
language plpgsql security definer set search_path = public as $$
declare c public.group_calls;
begin
  select * into c from public.group_calls where id = call_id and status = 'active';
  if not found then raise exception 'call ended' using errcode = 'P0001'; end if;
  if not public.is_member(c.conversation_id) then raise exception 'not a member' using errcode = '42501'; end if;
  insert into public.group_call_participants (group_call_id, user_id) values (c.id, auth.uid())
    on conflict (group_call_id, user_id) do update set left_at = null, joined_at = now();
  return c;
end $$;

create function public.leave_group_call(call_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.group_call_participants set left_at = now()
   where group_call_id = call_id and user_id = auth.uid();
$$;

create function public.end_group_call(call_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.group_calls;
begin
  select * into c from public.group_calls where id = call_id;
  if not found then return; end if;
  if c.started_by <> auth.uid() and not public.is_group_admin(c.conversation_id) then
    raise exception 'only the host or a group admin can end the call' using errcode = '42501';
  end if;
  update public.group_calls set status = 'ended', ended_at = now() where id = call_id;
end $$;

-- ───────────────────────── notifications ─────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('message', 'call', 'missed_call', 'group_call', 'contact_request', 'system')),
  conversation_id uuid references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete cascade,
  call_id uuid references public.calls(id) on delete cascade,
  group_call_id uuid references public.group_calls(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 240),
  url text not null default '/app/chats',
  read_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_message_uidx on public.notifications (user_id, message_id) where kind = 'message';
create unique index notifications_call_uidx on public.notifications (user_id, call_id, kind) where kind in ('call', 'missed_call');
create unique index notifications_group_call_uidx on public.notifications (user_id, group_call_id) where kind = 'group_call';
create unique index notifications_contact_uidx on public.notifications (user_id, contact_id) where kind = 'contact_request';
alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete_own on public.notifications for delete to authenticated using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

create function public.notify_new_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations; sender_name text; preview text;
begin
  select * into c from public.conversations where id = new.conversation_id;
  select display_name into sender_name from public.profiles where id = new.sender_id;
  preview := case when char_length(new.body) = 0 then 'Sent an attachment' else left(new.body, 160) end;
  insert into public.notifications (user_id, kind, conversation_id, message_id, title, body, url)
  select cm.user_id, 'message', new.conversation_id, new.id,
         case when c.kind = 'group' then coalesce(c.title, 'Group') || ' · ' || coalesce(sender_name, 'Someone')
              else coalesce(sender_name, 'New message') end,
         case when c.kind = 'group' then coalesce(sender_name, 'Someone') || ': ' || preview else preview end,
         '/app/chats/' || new.conversation_id || '?message=' || new.id
    from public.conversation_members cm
    join public.user_settings s on s.user_id = cm.user_id
   where cm.conversation_id = new.conversation_id
     and cm.user_id <> new.sender_id
     and s.notify_messages
     and (cm.muted_until is null or cm.muted_until < now())
     and not public.is_blocked(cm.user_id, new.sender_id)
  on conflict do nothing;
  return new;
end $$;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_new_message();

create function public.notify_message_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.notifications set body = 'Message deleted', title = 'Message deleted'
     where message_id = new.id and kind = 'message';
  end if;
  return new;
end $$;
create trigger messages_notify_delete after update of deleted_at on public.messages
  for each row execute function public.notify_message_deleted();

create function public.notify_call() returns trigger
language plpgsql security definer set search_path = public as $$
declare caller_name text; notify boolean; muted boolean;
begin
  select display_name into caller_name from public.profiles where id = new.caller_id;
  select coalesce(s.notify_calls, true) into notify from public.user_settings s where s.user_id = new.callee_id;
  select coalesce(cm.muted_until > now(), false) into muted from public.conversation_members cm
   where cm.conversation_id = new.conversation_id and cm.user_id = new.callee_id;
  if coalesce(notify, true) and not coalesce(muted, false) and not public.is_blocked(new.caller_id, new.callee_id) then
    insert into public.notifications (user_id, kind, conversation_id, call_id, title, body, url)
    values (new.callee_id, 'call', new.conversation_id, new.id, coalesce(caller_name, 'Incoming call'),
            'Incoming ' || new.kind || ' call', '/app/calls')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger calls_notify after insert on public.calls
  for each row execute function public.notify_call();

create function public.notify_missed_call() returns trigger
language plpgsql security definer set search_path = public as $$
declare caller_name text;
begin
  if new.status = 'missed' and old.status <> 'missed' then
    select display_name into caller_name from public.profiles where id = new.caller_id;
    delete from public.notifications where user_id = new.callee_id and call_id = new.id and kind = 'call';
    insert into public.notifications (user_id, kind, conversation_id, call_id, title, body, url)
    values (new.callee_id, 'missed_call', new.conversation_id, new.id, 'Missed call',
            'You missed a ' || new.kind || ' call from ' || coalesce(caller_name, 'someone'), '/app/calls')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger calls_notify_missed after update of status on public.calls
  for each row execute function public.notify_missed_call();

create function public.notify_group_call() returns trigger
language plpgsql security definer set search_path = public as $$
declare title_text text;
begin
  select coalesce(title, 'Group call') into title_text from public.conversations where id = new.conversation_id;
  insert into public.notifications (user_id, kind, conversation_id, group_call_id, title, body, url)
  select cm.user_id, 'group_call', new.conversation_id, new.id, title_text,
         'Group ' || new.kind || ' call started',
         '/app/chats/' || new.conversation_id || '?groupcall=' || new.id
    from public.conversation_members cm
    join public.user_settings s on s.user_id = cm.user_id
   where cm.conversation_id = new.conversation_id
     and cm.user_id <> new.started_by
     and s.notify_calls
     and (cm.muted_until is null or cm.muted_until < now())
  on conflict do nothing;
  return new;
end $$;
create trigger group_calls_notify after insert on public.group_calls
  for each row execute function public.notify_group_call();

create function public.notify_contact_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare name text;
begin
  if new.status = 'pending' then
    select display_name into name from public.profiles where id = new.requester_id;
    insert into public.notifications (user_id, kind, contact_id, title, body, url)
    values (new.addressee_id, 'contact_request', new.id, coalesce(name, 'Someone'), 'Sent you a contact request', '/app/contacts')
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger contacts_notify after insert on public.contacts
  for each row execute function public.notify_contact_request();

create function public.mark_conversation_unread(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare latest timestamptz;
begin
  if not public.is_member(cid) then raise exception 'not a member' using errcode = '42501'; end if;
  select max(created_at) into latest from public.messages
   where conversation_id = cid and sender_id <> auth.uid() and deleted_at is null;
  update public.conversation_reads
     set last_read_at = coalesce(latest - interval '1 millisecond', now() - interval '1 second')
   where conversation_id = cid and user_id = auth.uid();
end $$;

-- ───────────────────────── push subscriptions ─────────────────────────
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy push_select_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_insert_own on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_update_own on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_delete_own on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Lets a browser re-register an endpoint that belonged to a previously signed-in account.
create function public.save_push_subscription(endpoint text, p256dh_key text, auth_key text, ua text default '')
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = save_push_subscription.endpoint and user_id <> auth.uid();
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), endpoint, p256dh_key, auth_key, left(coalesce(ua, ''), 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, last_used_at = now();
end $$;

create function public.delete_push_subscription(endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = delete_push_subscription.endpoint and user_id = auth.uid();
$$;

-- ───────────────────────── call history without exposing profile columns ─────────────────────────
create function public.call_history(lim int default 50)
returns table (
  id uuid, conversation_id uuid, caller_id uuid, callee_id uuid, kind text, status text,
  end_reason text, created_at timestamptz, answered_at timestamptz, ended_at timestamptz,
  peer_id uuid, peer_username text, peer_display_name text, peer_avatar_path text
)
language sql stable security definer set search_path = public as $$
  select c.id, c.conversation_id, c.caller_id, c.callee_id, c.kind, c.status, c.end_reason,
         c.created_at, c.answered_at, c.ended_at,
         p.id, p.username, p.display_name,
         case when public.can_view_avatar(p.id) then p.avatar_path else null end
    from public.calls c
    join public.profiles p on p.id = case when c.caller_id = auth.uid() then c.callee_id else c.caller_id end
   where c.caller_id = auth.uid() or c.callee_id = auth.uid()
   order by c.created_at desc
   limit least(coalesce(lim, 50), 100);
$$;

create function public.my_group_call_history(lim int default 30)
returns table (
  id uuid, conversation_id uuid, conversation_title text, started_by uuid, kind text, status text,
  created_at timestamptz, ended_at timestamptz, participant_count bigint
)
language sql stable security definer set search_path = public as $$
  select gc.id, gc.conversation_id, coalesce(c.title, 'Group'), gc.started_by, gc.kind, gc.status,
         gc.created_at, gc.ended_at,
         (select count(*) from public.group_call_participants p where p.group_call_id = gc.id and p.left_at is null)
    from public.group_calls gc
    join public.conversations c on c.id = gc.conversation_id
    join public.conversation_members cm on cm.conversation_id = gc.conversation_id and cm.user_id = auth.uid()
   order by gc.created_at desc
   limit least(coalesce(lim, 30), 100);
$$;

revoke all on function public.create_group(text, text, uuid[]), public.update_group(uuid, text, text),
  public.set_group_photo(uuid, text), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.set_group_member_role(uuid, uuid, boolean),
  public.leave_group(uuid), public.delete_group(uuid), public.start_group_call(uuid, text),
  public.join_group_call(uuid), public.leave_group_call(uuid), public.end_group_call(uuid),
  public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text),
  public.call_history(int), public.my_group_call_history(int), public.mark_conversation_unread(uuid) from public, anon;

grant execute on function public.create_group(text, text, uuid[]), public.update_group(uuid, text, text),
  public.set_group_photo(uuid, text), public.add_group_members(uuid, uuid[]),
  public.remove_group_member(uuid, uuid), public.set_group_member_role(uuid, uuid, boolean),
  public.leave_group(uuid), public.delete_group(uuid), public.start_group_call(uuid, text),
  public.join_group_call(uuid), public.leave_group_call(uuid), public.end_group_call(uuid),
  public.save_push_subscription(text, text, text, text), public.delete_push_subscription(text),
  public.call_history(int), public.my_group_call_history(int), public.mark_conversation_unread(uuid) to authenticated;

alter publication supabase_realtime add table public.group_calls;
alter publication supabase_realtime add table public.notifications;


-- ═════════════════════════════════════════════════════════════════════════════
-- backfill-profiles.sql
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- ChatSpace — recreate profile rows for accounts that already existed.
--
-- `handle_new_user` only fires when a user signs up, so accounts created before a
-- schema reset (or imported through the dashboard) have no profile row and cannot
-- use the app. Run this after the migrations and it is safe to run repeatedly.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.profiles (id, username, display_name)
select u.id,
       case
         when lower(coalesce(u.raw_user_meta_data->>'username', '')) ~ '^[a-z0-9_]{3,24}$'
           then lower(u.raw_user_meta_data->>'username')
         else 'user_' || left(replace(u.id::text, '-', ''), 8)
       end,
       left(
         coalesce(
           nullif(u.raw_user_meta_data->>'display_name', ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
           'ChatSpace user'
         ), 50)
  from auth.users u
on conflict do nothing;

insert into public.user_settings (user_id)
select p.id from public.profiles p
on conflict (user_id) do nothing;
