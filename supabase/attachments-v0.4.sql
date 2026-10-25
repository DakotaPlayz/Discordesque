-- Mirlume v0.4 attachment upgrade.
-- Run ONCE after: supabase/schema.sql, direct-messages.sql, file-sharing.sql.
-- Preserves existing text messages, membership and prior P2P invites.

-- All server files are stored PRIVATE, maximum 50,000,000 bytes per object.
insert into storage.buckets (id, name, public, file_size_limit)
values ('mirlume-channel-files', 'mirlume-channel-files', false, 50000000)
on conflict (id) do update
  set public=false, file_size_limit=50000000;

create table if not exists public.channel_attachments (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id),
  object_path text not null unique check (char_length(object_path) < 300),
  filename text not null check (char_length(filename) between 1 and 255),
  size_bytes bigint not null check (size_bytes between 1 and 50000000),
  content_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now()
);
create index if not exists idx_channel_attachments_channel on public.channel_attachments(channel_id, created_at desc);
alter table public.channel_attachments enable row level security;

-- Use a SECURITY DEFINER function for clean validation and to avoid
-- unsafe casts of user-controlled path strings in storage RLS.
create or replace function public.can_upload_mirlume_channel_file(p_path text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  pieces text[];
  sid uuid;
  cid uuid;
  uploader uuid;
begin
  pieces := string_to_array(p_path, '/');
  if array_length(pieces,1) <> 4 then return false; end if;
  if pieces[1] !~* '^[a-f0-9-]{36}$' or
     pieces[2] !~* '^[a-f0-9-]{36}$' or
     pieces[3] !~* '^[a-f0-9-]{36}$' or
     pieces[4] !~* '^[a-f0-9-]{36}$' then return false; end if;
  sid := pieces[1]::uuid;
  cid := pieces[2]::uuid;
  uploader := pieces[3]::uuid;
  return uploader = auth.uid()
    and public.is_server_member(sid)
    and exists (select 1 from public.channels c where c.id = cid and c.server_id = sid);
exception when invalid_text_representation then return false;
end;
$$;

create or replace function public.can_read_mirlume_channel_file(p_path text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  pieces text[];
  sid uuid;
begin
  pieces := string_to_array(p_path, '/');
  if array_length(pieces,1) <> 4 or pieces[1] !~* '^[a-f0-9-]{36}$'
    then return false; end if;
  sid := pieces[1]::uuid;
  return public.is_server_member(sid);
exception when invalid_text_representation then return false;
end;
$$;

revoke all on function public.can_upload_mirlume_channel_file(text) from public;
revoke all on function public.can_read_mirlume_channel_file(text) from public;
grant execute on function public.can_upload_mirlume_channel_file(text) to authenticated;
grant execute on function public.can_read_mirlume_channel_file(text) to authenticated;

drop policy if exists "Mirlume users may upload private channel files" on storage.objects;
create policy "Mirlume users may upload private channel files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'mirlume-channel-files'
  and public.can_upload_mirlume_channel_file(name)
);

drop policy if exists "Mirlume members may read private channel files" on storage.objects;
create policy "Mirlume members may read private channel files"
on storage.objects for select to authenticated
using (
  bucket_id = 'mirlume-channel-files'
  and public.can_read_mirlume_channel_file(name)
);

-- No delete or update policy is granted to clients. Admin cleanup is manual.
drop policy if exists "Mirlume members may view channel attachments" on public.channel_attachments;
create policy "Mirlume members may view channel attachments"
on public.channel_attachments for select to authenticated
using (
  public.is_server_member(server_id) and
  exists (select 1 from public.channels c where c.id=channel_id and c.server_id=server_id)
);

drop policy if exists "Mirlume members may attach to channels" on public.channel_attachments;
create policy "Mirlume members may attach to channels"
on public.channel_attachments for insert to authenticated
with check (
  uploader_id=auth.uid()
  and public.is_server_member(server_id)
  and exists (select 1 from public.channels c where c.id=channel_id and c.server_id=server_id)
  and object_path like (server_id::text || '/' || channel_id::text || '/' || uploader_id::text || '/%')
  and public.can_upload_mirlume_channel_file(object_path)
  and exists (select 1 from storage.objects o
    where o.bucket_id='mirlume-channel-files' and o.name=object_path)
);

-- The existing P2P transfer service now uses DMs, not server channels.
alter table public.file_transfers
  alter column server_id drop not null,
  alter column channel_id drop not null;
alter table public.file_transfers
  add column if not exists conversation_id uuid references public.direct_conversations(id) on delete cascade;
-- Require exactly one context, so stale channel offers continue to be readable.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='mirlume_transfer_context'
  ) then
    alter table public.file_transfers add constraint mirlume_transfer_context
    check (
      (conversation_id is not null and channel_id is null and server_id is null)
      or (conversation_id is null and channel_id is not null and server_id is not null)
    );
  end if;
end $$;
create index if not exists idx_dm_file_transfers on public.file_transfers(conversation_id, created_at desc);

drop policy if exists "Mirlume DM peers may offer files" on public.file_transfers;
create policy "Mirlume DM peers may offer files"
on public.file_transfers for insert to authenticated with check (
  sender_id=auth.uid()
  and conversation_id is not null
  and server_id is null
  and channel_id is null
  and size_bytes between 1 and 21474836480
  and exists (
    select 1 from public.direct_conversations d
    where d.id=file_transfers.conversation_id
      and ((d.user_low=sender_id and d.user_high=recipient_id)
        or (d.user_high=sender_id and d.user_low=recipient_id))
  )
);

-- Enable realtime for displaying uploaded files promptly in channels.
do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='channel_attachments')
  then
    alter publication supabase_realtime add table public.channel_attachments;
  end if;
end $$;
