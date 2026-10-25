-- Mirlume v0.5: rich profiles, server identities, and server branding.
-- Run AFTER prior v0.4 migrations, once in the same Supabase project.
alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists status_text text not null default '',
  add column if not exists pronouns text not null default '',
  add column if not exists accent_color text not null default '#75DCC2',
  add column if not exists avatar_path text,
  add column if not exists banner_path text;

alter table public.server_members
  add column if not exists nickname text,
  add column if not exists server_avatar_path text,
  add column if not exists server_bio text not null default '';

alter table public.servers
  add column if not exists description text not null default '',
  add column if not exists icon_path text,
  add column if not exists banner_path text;

-- Constraints for user-editable fields.
do $$
begin
  if not exists (select 1 from pg_constraint where conname='mirlume_profile_details_check') then
    alter table public.profiles add constraint mirlume_profile_details_check check (
      char_length(bio)<=500 and char_length(status_text)<=100 and
      char_length(pronouns)<=40 and accent_color ~ '^#[0-9A-Fa-f]{6}$'
    );
  end if;
  if not exists (select 1 from pg_constraint where conname='mirlume_member_details_check') then
    alter table public.server_members add constraint mirlume_member_details_check check (
      (nickname is null or char_length(btrim(nickname)) between 2 and 32)
      and char_length(server_bio)<=300
    );
  end if;
  if not exists (select 1 from pg_constraint where conname='mirlume_server_description_check') then
    alter table public.servers add constraint mirlume_server_description_check check (
      char_length(description)<=500
    );
  end if;
end $$;

-- Storage objects are private; viewers get short-lived signed URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('mirlume-profile-media','mirlume-profile-media',false,10000000,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=10000000,
  allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif'];

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('mirlume-server-media','mirlume-server-media',false,10000000,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict(id) do update set public=false,file_size_limit=10000000,
  allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif'];

create or replace function public.mirlume_media_allowed(bucket text, object_path text, writing boolean)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare parts text[]; target uuid; sid uuid; who uuid;
begin
  if auth.uid() is null then return false; end if;
  parts := string_to_array(object_path,'/');
  if array_length(parts,1) <> 3 then return false; end if;
  if parts[1] !~* '^[0-9a-f-]{36}$' or parts[3] !~* '^[0-9a-f-]{36}$'
     then return false; end if;
  target:=parts[1]::uuid;
  if bucket='mirlume-profile-media' then
    if parts[2] not in ('avatar','banner') then return false; end if;
    if writing then return target=auth.uid(); end if;
    return target=auth.uid()
       or exists(select 1 from public.server_members x
                 join public.server_members y on x.server_id=y.server_id
                 where x.user_id=auth.uid() and y.user_id=target)
       or exists(select 1 from public.direct_conversations d
                 where (d.user_low=auth.uid() and d.user_high=target)
                    or (d.user_high=auth.uid() and d.user_low=target));
  elsif bucket='mirlume-server-media' then
    sid:=target;
    if parts[2] in ('icon','banner') then
      if writing then return public.is_server_owner(sid); end if;
      return public.is_server_member(sid);
    end if;
  end if;
  return false;
exception when invalid_text_representation then return false;
end $$;

-- Member-specific avatars live in separate logical namespace:
-- server-avatar/<server id>/<user id>/<uuid> would be four parts, so use
-- member media table and a dedicated 4-component checker.
create or replace function public.mirlume_member_media_allowed(object_path text, writing boolean)
returns boolean language plpgsql stable security definer set search_path=''
as $$
declare p text[]; sid uuid; uid uuid;
begin
  p:=string_to_array(object_path,'/');
  if array_length(p,1)<>4 or p[1]<>'members' or
     p[2] !~* '^[0-9a-f-]{36}$' or p[3] !~* '^[0-9a-f-]{36}$' or
     p[4] !~* '^[0-9a-f-]{36}$' then return false; end if;
  sid:=p[2]::uuid; uid:=p[3]::uuid;
  if writing then return uid=auth.uid() and public.is_server_member(sid); end if;
  return public.is_server_member(sid);
exception when invalid_text_representation then return false;
end $$;

drop policy if exists "Mirlume profile uploads" on storage.objects;
create policy "Mirlume profile uploads" on storage.objects for insert to authenticated
with check (
  bucket_id='mirlume-profile-media' and (
    public.mirlume_media_allowed(bucket_id,name,true)
    or public.mirlume_member_media_allowed(name,true)
  )
);
drop policy if exists "Mirlume profile images readable by contacts" on storage.objects;
create policy "Mirlume profile images readable by contacts" on storage.objects for select to authenticated
using (
  bucket_id='mirlume-profile-media' and (
    public.mirlume_media_allowed(bucket_id,name,false)
    or public.mirlume_member_media_allowed(name,false)
  )
);
drop policy if exists "Mirlume server media uploads" on storage.objects;
create policy "Mirlume server media uploads" on storage.objects for insert to authenticated
with check (bucket_id='mirlume-server-media' and public.mirlume_media_allowed(bucket_id,name,true));
drop policy if exists "Mirlume server images readable by members" on storage.objects;
create policy "Mirlume server images readable by members" on storage.objects for select to authenticated
using (bucket_id='mirlume-server-media' and public.mirlume_media_allowed(bucket_id,name,false));

-- Members can edit only their own per-server identity. Clients have no
-- direct update grant on sensitive server data.
drop policy if exists "Mirlume members can edit own server profile" on public.server_members;
create policy "Mirlume members can edit own server profile"
on public.server_members for update to authenticated
using (user_id=auth.uid() and public.is_server_member(server_id))
with check (user_id=auth.uid() and public.is_server_member(server_id));

create or replace function public.mirlume_set_server_branding(
  p_server uuid,p_description text,p_icon_path text,p_banner_path text
)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  if not public.is_server_owner(p_server) then raise exception 'Owner required'; end if;
  if char_length(coalesce(p_description,''))>500 then raise exception 'Description too long'; end if;
  if p_icon_path is not null and p_icon_path !~* (
     '^'||p_server::text||'/icon/[0-9a-f-]{36}$') then raise exception 'Invalid icon'; end if;
  if p_banner_path is not null and p_banner_path !~* (
     '^'||p_server::text||'/banner/[0-9a-f-]{36}$') then raise exception 'Invalid banner'; end if;
  update public.servers set description=coalesce(p_description,''),
    icon_path=p_icon_path,banner_path=p_banner_path where id=p_server;
  return true;
end $$;

revoke all on function public.mirlume_media_allowed(text,text,boolean) from public;
revoke all on function public.mirlume_member_media_allowed(text,boolean) from public;
revoke all on function public.mirlume_set_server_branding(uuid,text,text,text) from public;
grant execute on function public.mirlume_media_allowed(text,text,boolean) to authenticated;
grant execute on function public.mirlume_member_media_allowed(text,boolean) to authenticated;
grant execute on function public.mirlume_set_server_branding(uuid,text,text,text) to authenticated;


-- Use narrow RPCs rather than allowing arbitrary updates of membership keys.
create or replace function public.mirlume_set_member_identity(
 p_server uuid, p_nickname text, p_bio text, p_avatar text
)
returns boolean language plpgsql security definer set search_path=''
as $$
begin
  if not public.is_server_member(p_server) then raise exception 'Server membership required'; end if;
  if p_nickname is not null and char_length(btrim(p_nickname)) not between 2 and 32
    then raise exception 'Nickname must be 2 to 32 characters'; end if;
  if char_length(coalesce(p_bio,''))>300 then raise exception 'Server bio too long'; end if;
  if p_avatar is not null and p_avatar !~* (
    '^members/'||p_server::text||'/'||auth.uid()::text||'/[0-9a-f-]{36}$')
    then raise exception 'Invalid member avatar'; end if;
  update public.server_members
  set nickname = nullif(btrim(p_nickname),''),
    server_bio=coalesce(p_bio,''), server_avatar_path=p_avatar
  where server_id=p_server and user_id=auth.uid();
  return found;
end $$;
revoke all on function public.mirlume_set_member_identity(uuid,text,text,text) from public;
grant execute on function public.mirlume_set_member_identity(uuid,text,text,text) to authenticated;
