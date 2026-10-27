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
