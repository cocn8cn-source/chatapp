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
