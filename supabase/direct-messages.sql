-- Mirlume v0.3: private one-to-one messages.
-- Run ONCE in Supabase SQL Editor AFTER supabase/schema.sql.
-- Preserves all original Discordesque accounts, servers, channels, and messages.
-- New conversations can only be started between users sharing a server.

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_low,user_high),
  constraint participants_ordered check (user_low < user_high)
);

create table if not exists public.direct_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists idx_direct_conversation_low on public.direct_conversations(user_low, created_at desc);
create index if not exists idx_direct_conversation_high on public.direct_conversations(user_high, created_at desc);
create index if not exists idx_direct_messages_recent on public.direct_messages(conversation_id, created_at desc);

create or replace function public.is_dm_participant(p_conversation uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.direct_conversations d
    where d.id=p_conversation and (select auth.uid()) in (d.user_low,d.user_high)
  );
$$;

-- Only users who are members of at least one common server may start a new DM.
create or replace function public.start_direct_message(p_peer uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  p_me uuid := auth.uid();
  p_low uuid;
  p_high uuid;
  p_existing uuid;
begin
  if p_me is null then raise exception 'Sign in to start a message'; end if;
  if p_peer is null or p_peer = p_me then raise exception 'Select another member'; end if;
  if not exists (select 1 from public.profiles p where p.id=p_peer) then
    raise exception 'Member not found';
  end if;
  if not exists (
    select 1 from public.server_members a
    join public.server_members b on a.server_id = b.server_id
    where a.user_id=p_me and b.user_id=p_peer
  ) then raise exception 'You can only message members of a shared space'; end if;

  p_low := least(p_me, p_peer);
  p_high := greatest(p_me, p_peer);

  insert into public.direct_conversations(user_low,user_high)
  values (p_low,p_high) on conflict(user_low,user_high) do nothing;
  select d.id into p_existing from public.direct_conversations d
  where d.user_low=p_low and d.user_high=p_high;
  return p_existing;
end;
$$;

alter table public.direct_conversations enable row level security;
alter table public.direct_messages enable row level security;

drop policy if exists "DM participants can read conversations" on public.direct_conversations;
create policy "DM participants can read conversations"
on public.direct_conversations for select to authenticated
using ((select auth.uid()) in (user_low,user_high));

drop policy if exists "DM participants can read messages" on public.direct_messages;
create policy "DM participants can read messages"
on public.direct_messages for select to authenticated
using (public.is_dm_participant(conversation_id));

drop policy if exists "DM participants can send own messages" on public.direct_messages;
create policy "DM participants can send own messages"
on public.direct_messages for insert to authenticated
with check (
  author_id = (select auth.uid())
  and public.is_dm_participant(conversation_id)
);

-- Existing profile RLS only allows common-server visibility. Preserve a DM's
-- display name after the members stop sharing a server.
drop policy if exists "DM contacts can read display names" on public.profiles;
create policy "DM contacts can read display names"
on public.profiles for select to authenticated using (
  exists (
    select 1 from public.direct_conversations d
    where (d.user_low=(select auth.uid()) and d.user_high=profiles.id)
       or (d.user_high=(select auth.uid()) and d.user_low=profiles.id)
  )
);

revoke all on function public.is_dm_participant(uuid) from public;
revoke all on function public.start_direct_message(uuid) from public;
grant execute on function public.is_dm_participant(uuid) to authenticated;
grant execute on function public.start_direct_message(uuid) to authenticated;
grant select on public.direct_conversations,public.direct_messages to authenticated;
grant insert on public.direct_messages to authenticated;
grant usage, select on sequence public.direct_messages_id_seq to authenticated;

-- Safe to re-run: avoid duplicate publication errors.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='direct_messages'
  ) then
    alter publication supabase_realtime add table public.direct_messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public'
      and tablename='direct_conversations'
  ) then
    alter publication supabase_realtime add table public.direct_conversations;
  end if;
end $$;
