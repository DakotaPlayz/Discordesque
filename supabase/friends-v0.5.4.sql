-- Mirlume friendships v0.5.4. Run in Supabase SQL Editor after direct-messages.sql.
create table if not exists public.mirlume_friends (
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  primary key (user_low,user_high),
  check (user_low < user_high),
  check (requested_by in (user_low,user_high))
);
create index if not exists mirlume_friends_high_idx on public.mirlume_friends(user_high);
alter table public.mirlume_friends enable row level security;
drop policy if exists "Friends read own relationships" on public.mirlume_friends;
create policy "Friends read own relationships" on public.mirlume_friends for select to authenticated
using (auth.uid() in (user_low,user_high));
grant select on public.mirlume_friends to authenticated;

-- Search only public display names. Search requires at least 2 characters.
create or replace function public.mirlume_find_people(p_query text)
returns table(id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select p.id,p.display_name from public.profiles p
  where auth.uid() is not null and p.id <> auth.uid()
    and char_length(btrim(coalesce(p_query,''))) >= 2
    and p.display_name ilike ('%' || btrim(p_query) || '%')
  order by p.display_name,p.id limit 20;
$$;

create or replace function public.mirlume_friend_action(p_peer uuid,p_action text)
returns text language plpgsql security definer set search_path = ''
as $$
declare me uuid := auth.uid(); lo uuid; hi uuid; row_data public.mirlume_friends%rowtype;
begin
  if me is null then raise exception 'Please sign in'; end if;
  if p_peer is null or p_peer=me then raise exception 'Choose another user'; end if;
  if not exists(select 1 from public.profiles where id=p_peer) then raise exception 'User not found'; end if;
  lo:=least(me,p_peer);hi:=greatest(me,p_peer);
  select * into row_data from public.mirlume_friends where user_low=lo and user_high=hi for update;
  if p_action='request' then
    if found then
      if row_data.status='accepted' then return 'already_friends'; end if;
      if row_data.requested_by=me then return 'already_requested'; end if;
      update public.mirlume_friends set status='accepted' where user_low=lo and user_high=hi;
      return 'accepted';
    end if;
    insert into public.mirlume_friends(user_low,user_high,requested_by)
      values(lo,hi,me) on conflict do nothing;
    return 'requested';
  elsif p_action='accept' then
    if not found or row_data.status<>'pending' or row_data.requested_by=me then
      raise exception 'No incoming friend request to accept';
    end if;
    update public.mirlume_friends set status='accepted' where user_low=lo and user_high=hi;
    return 'accepted';
  elsif p_action='remove' then
    if not found then return 'not_found'; end if;
    delete from public.mirlume_friends where user_low=lo and user_high=hi;
    return 'removed';
  else raise exception 'Invalid friend action';
  end if;
end;
$$;

-- Friends retain profile visibility even without a shared server or existing DM.
drop policy if exists "Friends can read profiles" on public.profiles;
create policy "Friends can read profiles" on public.profiles for select to authenticated
using (exists(select 1 from public.mirlume_friends f
 where ((f.user_low=auth.uid() and f.user_high=profiles.id) or
  (f.user_high=auth.uid() and f.user_low=profiles.id))));

-- Extend the existing DM start rule: shared-server members OR accepted friends.
create or replace function public.start_direct_message(p_peer uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare me uuid:=auth.uid(); lo uuid; hi uuid; existing uuid;
begin
 if me is null then raise exception 'Sign in to start a message'; end if;
 if p_peer is null or p_peer=me then raise exception 'Select another member'; end if;
 if not exists(select 1 from public.profiles where id=p_peer) then raise exception 'Member not found'; end if;
 if not exists(select 1 from public.server_members a join public.server_members b
      on a.server_id=b.server_id where a.user_id=me and b.user_id=p_peer)
    and not exists(select 1 from public.mirlume_friends f where f.status='accepted'
      and f.user_low=least(me,p_peer) and f.user_high=greatest(me,p_peer))
 then raise exception 'You must be friends or share a server to message'; end if;
 lo:=least(me,p_peer);hi:=greatest(me,p_peer);
 insert into public.direct_conversations(user_low,user_high)
 values(lo,hi) on conflict(user_low,user_high) do nothing;
 select id into existing from public.direct_conversations where user_low=lo and user_high=hi;
 return existing;
end;
$$;

-- Permit friend profile avatars via existing media security function (replace existing v0.5 function).
create or replace function public.mirlume_friend_ids()
returns table(peer_id uuid) language sql stable security definer set search_path=''
as $$
 select case when user_low=auth.uid() then user_high else user_low end
 from public.mirlume_friends where status='accepted' and auth.uid() in (user_low,user_high);
$$;
revoke all on function public.mirlume_find_people(text) from public,anon;
revoke all on function public.mirlume_friend_action(uuid,text) from public,anon;
revoke all on function public.mirlume_friend_ids() from public,anon;
grant execute on function public.mirlume_find_people(text) to authenticated;
grant execute on function public.mirlume_friend_action(uuid,text) to authenticated;
grant execute on function public.mirlume_friend_ids() to authenticated;
