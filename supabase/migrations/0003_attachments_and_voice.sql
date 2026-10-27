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
