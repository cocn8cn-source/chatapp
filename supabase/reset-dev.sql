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
