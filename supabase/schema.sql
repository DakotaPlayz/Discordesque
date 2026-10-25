-- Discordesque v0.1. Run once in your Supabase SQL editor.
-- The client uses the publishable/anon key, NEVER the service-role key.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 32),
  created_at timestamptz not null default now()
);

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 48),
  owner_id uuid not null references public.profiles(id),
  invite_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create index if not exists idx_members_user on public.server_members(user_id);

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_-]{1,32}$'),
  kind text not null default 'text' check (kind = 'text'),
  created_at timestamptz not null default now(),
  unique(server_id, name)
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  channel_id uuid not null references public.channels(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists idx_messages_channel_time on public.messages(channel_id, created_at desc);

-- Security-definer membership checks break policy recursion safely.
create or replace function public.is_server_member(sid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.server_members m
    where m.server_id = sid and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_server_owner(sid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.servers s
    where s.id = sid and s.owner_id = (select auth.uid())
  );
$$;

alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

create policy "Profiles shared within a server" on public.profiles
for select to authenticated using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.server_members a
    join public.server_members b on a.server_id = b.server_id
    where a.user_id = (select auth.uid()) and b.user_id = profiles.id
  )
);

create policy "Members can edit their profile" on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "Members can see servers" on public.servers
for select to authenticated using (public.is_server_member(id));

create policy "Members can see members" on public.server_members
for select to authenticated using (public.is_server_member(server_id));

create policy "Members can see channels" on public.channels
for select to authenticated using (public.is_server_member(server_id));

create policy "Members can read messages" on public.messages
for select to authenticated using (
  exists (select 1 from public.channels c
          where c.id = channel_id and public.is_server_member(c.server_id))
);

create policy "Members can send their messages" on public.messages
for insert to authenticated with check (
  author_id = (select auth.uid())
  and exists (select 1 from public.channels c
              where c.id = channel_id and public.is_server_member(c.server_id))
);

-- Creates profiles without requiring users to have direct insert rights.
create or replace function public.on_user_created()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, 'Member-' || substring(new.id::text from 1 for 6))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists discordesque_auth_user_created on auth.users;
create trigger discordesque_auth_user_created
after insert on auth.users for each row execute function public.on_user_created();

-- Backfill accounts created before the trigger.
insert into public.profiles(id, display_name)
select id, 'Member-' || substring(id::text from 1 for 6) from auth.users
on conflict (id) do nothing;

-- Group creation, membership and channel creation happen ONLY through RPCs.
create or replace function public.create_server(p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  sid uuid;
  clean_name text := btrim(p_name);
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if char_length(clean_name) not between 2 and 48 then
    raise exception 'Server name must contain 2 to 48 characters';
  end if;

  insert into public.servers(name, owner_id, invite_code)
  values (clean_name, auth.uid(),
          substring(replace(gen_random_uuid()::text, '-', '') from 1 for 12))
  returning id into sid;

  insert into public.server_members(server_id, user_id)
  values (sid, auth.uid());

  insert into public.channels(server_id, name) values (sid, 'general');
  return sid;
end;
$$;

create or replace function public.join_server(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  sid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select s.id into sid from public.servers s
  where s.invite_code = lower(btrim(p_code));
  if sid is null then raise exception 'Invalid invitation code'; end if;
  insert into public.server_members(server_id, user_id)
  values (sid, auth.uid()) on conflict do nothing;
  return sid;
end;
$$;

create or replace function public.create_channel(p_server_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  cid uuid;
  clean_name text := lower(btrim(p_name));
begin
  if not public.is_server_owner(p_server_id) then
    raise exception 'Only the server owner can create channels';
  end if;
  if clean_name !~ '^[a-z0-9_-]{1,32}$' then
    raise exception 'Use 1-32 lowercase letters, digits, hyphens or underscores';
  end if;
  insert into public.channels(server_id, name)
  values (p_server_id, clean_name) returning id into cid;
  return cid;
end;
$$;

revoke all on function public.is_server_member(uuid) from public;
revoke all on function public.is_server_owner(uuid) from public;
revoke all on function public.create_server(text) from public;
revoke all on function public.join_server(text) from public;
revoke all on function public.create_channel(uuid,text) from public;
grant execute on function public.is_server_member(uuid) to authenticated;
grant execute on function public.is_server_owner(uuid) to authenticated;
grant execute on function public.create_server(text) to authenticated;
grant execute on function public.join_server(text) to authenticated;
grant execute on function public.create_channel(uuid,text) to authenticated;

-- Supabase Realtime needs the messages table in this publication.
alter publication supabase_realtime add table public.messages;
