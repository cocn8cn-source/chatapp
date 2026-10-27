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
