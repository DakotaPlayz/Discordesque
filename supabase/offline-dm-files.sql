-- Mirlume v0.5.1: persistent small DM attachments.
-- Run ONCE AFTER schema.sql, direct-messages.sql, attachments-v0.4.sql,
-- auto-dm-delivery.sql and profiles-v0.5.sql in your existing project.
-- Files <= 50 MB stay available even if sender is offline.
-- Files > 50 MB need separate always-online storage for true offline delivery.

insert into storage.buckets(id,name,public,file_size_limit)
values ('mirlume-dm-files','mirlume-dm-files',false,50000000)
on conflict(id) do update set public=false,file_size_limit=50000000;

create table if not exists public.dm_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  storage_path text not null unique check (char_length(storage_path) < 220),
  filename text not null check (char_length(filename) between 1 and 255),
  size_bytes bigint not null check (size_bytes between 1 and 50000000),
  content_type text not null default 'application/octet-stream',
  created_at timestamptz not null default now()
);
create index if not exists idx_mirlume_dm_files on public.dm_attachments(conversation_id,created_at desc);
alter table public.dm_attachments enable row level security;

create or replace function public.mirlume_dm_storage_access(p_path text,p_upload boolean)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare parts text[]; conv uuid; creator uuid;
begin
  if auth.uid() is null then return false; end if;
  parts:=string_to_array(p_path,'/');
  if array_length(parts,1)<>3
    or parts[1] !~* '^[0-9a-f-]{36}$'
    or parts[2] !~* '^[0-9a-f-]{36}$'
    or parts[3] !~* '^[0-9a-f-]{36}$' then return false; end if;
  conv:=parts[1]::uuid;creator:=parts[2]::uuid;
  if p_upload and creator<>auth.uid() then return false; end if;
  return exists(
    select 1 from public.direct_conversations d
    where d.id=conv and auth.uid() in (d.user_low,d.user_high)
      and (not p_upload or creator in (d.user_low,d.user_high))
  );
exception when invalid_text_representation then return false;
end $$;
revoke all on function public.mirlume_dm_storage_access(text,boolean) from public;
grant execute on function public.mirlume_dm_storage_access(text,boolean) to authenticated;

drop policy if exists "Mirlume DM sender uploads own files" on storage.objects;
create policy "Mirlume DM sender uploads own files"
on storage.objects for insert to authenticated with check (
  bucket_id='mirlume-dm-files'
  and public.mirlume_dm_storage_access(name,true)
);

drop policy if exists "Mirlume DM peers download their files" on storage.objects;
create policy "Mirlume DM peers download their files"
on storage.objects for select to authenticated using (
  bucket_id='mirlume-dm-files'
  and public.mirlume_dm_storage_access(name,false)
);

drop policy if exists "Mirlume DM peers see offline attachments" on public.dm_attachments;
create policy "Mirlume DM peers see offline attachments"
on public.dm_attachments for select to authenticated using (
  public.is_dm_participant(conversation_id)
);

drop policy if exists "Mirlume send offline DM files" on public.dm_attachments;
create policy "Mirlume send offline DM files"
on public.dm_attachments for insert to authenticated with check (
  sender_id=auth.uid()
  and public.is_dm_participant(conversation_id)
  and storage_path like (conversation_id::text||'/'||sender_id::text||'/%')
  and public.mirlume_dm_storage_access(storage_path,true)
  and exists (select 1 from storage.objects o
    where o.bucket_id='mirlume-dm-files' and o.name=storage_path)
);

do $$
begin
  if not exists (select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='dm_attachments') then
    alter publication supabase_realtime add table public.dm_attachments;
  end if;
end $$;
