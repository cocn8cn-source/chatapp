-- 0007: fix `column reference "endpoint" is ambiguous` in save_push_subscription.
--
-- The function parameter is called `endpoint`, which is also a column of
-- public.push_subscriptions. PL/pgSQL could not decide which one the bare
-- `endpoint` meant, so EVERY call failed and no browser could ever register for
-- web push. The parameter names stay the same (the client calls this RPC by name),
-- only the body changes: every column is qualified with a table alias and the
-- parameter is always written as save_push_subscription.endpoint.
--
-- Safe to run on an existing database: CREATE OR REPLACE keeps the grants and
-- does not touch any data.

create or replace function public.save_push_subscription(endpoint text, p256dh_key text, auth_key text, ua text default '')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- A browser keeps the same endpoint across sign-outs/sign-ins, so the row may belong
  -- to a previously signed-in account. Drop it wherever it is, then store it for the
  -- current user. (Delete + insert instead of ON CONFLICT (endpoint), which has the
  -- same name clash.)
  delete from public.push_subscriptions ps where ps.endpoint = save_push_subscription.endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), save_push_subscription.endpoint, p256dh_key, auth_key, left(coalesce(ua, ''), 300))
  on conflict do nothing;
end $$;

-- delete_push_subscription already qualified its parameter and works, but give the
-- table an alias too so the intent is unambiguous.
create or replace function public.delete_push_subscription(endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions ps
   where ps.endpoint = delete_push_subscription.endpoint and ps.user_id = auth.uid();
$$;
