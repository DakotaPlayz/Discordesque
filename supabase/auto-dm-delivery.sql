-- Mirlume 0.4.1: DM file cards with one-click downloading and transfer status.
-- Run AFTER attachments-v0.4.sql in the existing Supabase project.
-- The sender and receiver must be online for WebRTC transfers.
-- The recipient clicks Download; claiming prevents duplicate downloads.

alter table public.file_transfers
  add column if not exists transfer_status text not null default 'waiting';

do $migration$
begin
  if not exists (select 1 from pg_constraint
    where conname='mirlume_transfer_status_values') then
    alter table public.file_transfers
      add constraint mirlume_transfer_status_values
      check (transfer_status in ('waiting','receiving','completed','failed','cancelled'));
  end if;
end $migration$;

create index if not exists idx_mirlume_dm_waiting
  on public.file_transfers(recipient_id, transfer_status, created_at desc);

create or replace function public.claim_mirlume_dm_transfer(p_transfer_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $func$
declare claimed_count integer;
begin
  if auth.uid() is null then return false; end if;
  update public.file_transfers t
  set transfer_status = 'receiving'
  where t.id = p_transfer_id
    and t.recipient_id = auth.uid()
    and t.conversation_id is not null
    and t.transfer_status = 'waiting'
    and t.created_at > now() - interval '15 minutes'
    and t.size_bytes between 1 and 21474836480;
  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end $func$;

create or replace function public.finish_mirlume_dm_transfer(
  p_transfer_id uuid, p_outcome text
)
returns boolean language plpgsql security definer set search_path = ''
as $func$
declare finished_count integer;
begin
  if auth.uid() is null then return false; end if;
  if p_outcome not in ('completed','failed','cancelled') then
    raise exception 'Invalid transfer outcome';
  end if;
  update public.file_transfers t
  set transfer_status = p_outcome
  where t.id = p_transfer_id
    and t.conversation_id is not null
    and (
      (t.recipient_id = auth.uid() and t.transfer_status = 'receiving')
      or (t.sender_id = auth.uid() and p_outcome = 'cancelled'
          and t.transfer_status in ('waiting','receiving'))
    );
  get diagnostics finished_count = row_count;
  return finished_count = 1;
end $func$;

revoke all on function public.claim_mirlume_dm_transfer(uuid) from public;
revoke all on function public.finish_mirlume_dm_transfer(uuid,text) from public;
grant execute on function public.claim_mirlume_dm_transfer(uuid) to authenticated;
grant execute on function public.finish_mirlume_dm_transfer(uuid,text) to authenticated;
