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
