-- Mirlume server-owner deletion. Run once in Supabase SQL Editor after schema.sql.
-- Security: only the authenticated server owner may remove a server.
-- Deleting a server cascades to server_members, channels, messages, and
-- server preferences through existing ON DELETE CASCADE foreign keys.
create or replace function public.mirlume_delete_server(p_server uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Sign in required';
  end if;
  -- Atomic owner check: another member cannot invoke deletion.
  delete from public.servers s
  where s.id = p_server and s.owner_id = current_user_id;
  if not found then
    raise exception 'Server not found or you are not its owner';
  end if;
  return true;
end;
$$;
revoke all on function public.mirlume_delete_server(uuid) from public;
revoke all on function public.mirlume_delete_server(uuid) from anon;
grant execute on function public.mirlume_delete_server(uuid) to authenticated;
