-- Mirlume v0.5.2 server and DM context-menu preferences.
-- Run AFTER schema.sql, direct-messages.sql, auto-dm-delivery.sql, profiles-v0.5.sql.
-- This migration is safe to re-run and does not erase existing chats.
create table if not exists public.mirlume_server_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  notification_level text not null default 'mentions'
    check (notification_level in ('all','mentions','none')),
  muted_until timestamptz,
  hide_muted_channels boolean not null default false,
  show_all_channels boolean not null default true,
  allow_dm_from_members boolean not null default true,
  favorite boolean not null default false,
  folder_name text not null default '' check (char_length(folder_name)<=32),
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id,server_id)
);
create table if not exists public.mirlume_dm_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  nickname text not null default '' check (char_length(nickname)<=40),
  private_note text not null default '' check (char_length(private_note)<=500),
  pinned boolean not null default false,
  favorite boolean not null default false,
  hidden boolean not null default false,
  ignored boolean not null default false,
  blocked boolean not null default false,
  muted_until timestamptz,
  last_read_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id,conversation_id)
);
alter table public.mirlume_server_preferences enable row level security;
alter table public.mirlume_dm_preferences enable row level security;
-- Explicit PostgREST permissions for user-controlled preferences.
grant select,insert,update on public.mirlume_server_preferences,public.mirlume_dm_preferences to authenticated;

drop policy if exists "Owner views own server settings" on public.mirlume_server_preferences;
create policy "Owner views own server settings" on public.mirlume_server_preferences
for select to authenticated using (user_id=auth.uid());
drop policy if exists "Owner creates own server settings" on public.mirlume_server_preferences;
create policy "Owner creates own server settings" on public.mirlume_server_preferences
for insert to authenticated with check (user_id=auth.uid() and public.is_server_member(server_id));
drop policy if exists "Owner updates own server settings" on public.mirlume_server_preferences;
create policy "Owner updates own server settings" on public.mirlume_server_preferences
for update to authenticated using (user_id=auth.uid() and public.is_server_member(server_id))
with check (user_id=auth.uid() and public.is_server_member(server_id));

drop policy if exists "Owner views own DM settings" on public.mirlume_dm_preferences;
create policy "Owner views own DM settings" on public.mirlume_dm_preferences
for select to authenticated using (user_id=auth.uid());
drop policy if exists "Owner creates own DM settings" on public.mirlume_dm_preferences;
create policy "Owner creates own DM settings" on public.mirlume_dm_preferences
for insert to authenticated with check (user_id=auth.uid() and public.is_dm_participant(conversation_id));
drop policy if exists "Owner updates own DM settings" on public.mirlume_dm_preferences;
create policy "Owner updates own DM settings" on public.mirlume_dm_preferences
for update to authenticated using (user_id=auth.uid() and public.is_dm_participant(conversation_id))
with check (user_id=auth.uid() and public.is_dm_participant(conversation_id));

-- Trigger function is SECURITY DEFINER, so blocked users cannot evade checks.
create or replace function public.mirlume_dm_is_blocked(p_conversation uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.mirlume_dm_preferences pref
    where pref.conversation_id=p_conversation and pref.blocked=true
  );
$$;
revoke all on function public.mirlume_dm_is_blocked(uuid) from public;
grant execute on function public.mirlume_dm_is_blocked(uuid) to authenticated;

-- A block stops both participants posting to the shared DM until unblocked.
drop policy if exists "DM participants can send own messages" on public.direct_messages;
create policy "DM participants can send own messages"
on public.direct_messages for insert to authenticated
with check (author_id=auth.uid() and public.is_dm_participant(conversation_id)
  and not public.mirlume_dm_is_blocked(conversation_id));

-- A nonowner can leave safely. The owner must hand off or delete their space.
create or replace function public.mirlume_leave_server(p_server uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare sid uuid:=auth.uid(); owner_id uuid;
begin
  if sid is null then raise exception 'Sign in required'; end if;
  select s.owner_id into owner_id from public.servers s where s.id=p_server;
  if owner_id is null then return false; end if;
  if sid=owner_id then raise exception 'Server owners must transfer ownership before leaving';
  end if;
  delete from public.mirlume_server_preferences
    where user_id=sid and server_id=p_server;
  delete from public.server_members where user_id=sid and server_id=p_server;
  return found;
end $$;
revoke all on function public.mirlume_leave_server(uuid) from public;
grant execute on function public.mirlume_leave_server(uuid) to authenticated;

-- A DM only accepts a new direct conversation when the recipient permits
-- contact from the relevant shared server, and neither has an existing block.
create or replace function public.start_direct_message(p_peer uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare p_me uuid:=auth.uid(); low_id uuid; high_id uuid; result_id uuid;
begin
  if p_me is null then raise exception 'Sign in required'; end if;
  if p_peer is null or p_peer=p_me then raise exception 'Choose another member'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_peer)
    then raise exception 'Member not found'; end if;
  low_id:=least(p_me,p_peer); high_id:=greatest(p_me,p_peer);
  select c.id into result_id from public.direct_conversations c
    where c.user_low=low_id and c.user_high=high_id;
  if result_id is not null then
    if public.mirlume_dm_is_blocked(result_id) then
      raise exception 'This conversation is blocked';
    end if;
    return result_id;
  end if;
  if not exists (
    select 1 from public.server_members m
    join public.server_members peer on peer.server_id=m.server_id
    left join public.mirlume_server_preferences pref
      on pref.server_id=m.server_id and pref.user_id=p_peer
    where m.user_id=p_me and peer.user_id=p_peer
      and coalesce(pref.allow_dm_from_members,true)=true
  ) then raise exception 'This member does not accept new DMs from shared servers'; end if;
  insert into public.direct_conversations(user_low,user_high)
    values(low_id,high_id) on conflict(user_low,user_high) do nothing;
  select c.id into result_id from public.direct_conversations c
    where c.user_low=low_id and c.user_high=high_id;
  return result_id;
end $$;
revoke all on function public.start_direct_message(uuid) from public;
grant execute on function public.start_direct_message(uuid) to authenticated;
