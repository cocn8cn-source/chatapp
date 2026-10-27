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
