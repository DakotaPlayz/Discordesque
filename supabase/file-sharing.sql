-- Discordesque v0.2 P2P file transfer signaling.
-- Apply AFTER supabase/schema.sql, once, in the SAME Supabase project.
-- No file contents are stored in Supabase. The sender keeps the file open.
-- 20 GiB maximum; sender and receiver must both be online.

create table if not exists public.file_transfers (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 255),
  size_bytes bigint not null check (size_bytes between 1 and 21474836480),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create index if not exists idx_file_transfers_recipient on public.file_transfers(recipient_id, created_at desc);
create index if not exists idx_file_transfers_channel on public.file_transfers(channel_id, created_at desc);

create table if not exists public.transfer_signals (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.file_transfers(id) on delete cascade,
  from_user uuid not null references public.profiles(id) on delete cascade,
  to_user uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'ice', 'reject', 'cancel')),
  payload jsonb not null default '{}'::jsonb check (octet_length(payload::text) < 65536),
  created_at timestamptz not null default now()
);

create index if not exists idx_transfer_signals_to_time on public.transfer_signals(to_user, created_at desc);
create index if not exists idx_transfer_signals_transfer on public.transfer_signals(transfer_id, created_at desc);

alter table public.file_transfers enable row level security;
alter table public.transfer_signals enable row level security;

create policy "File offers only visible to participants"
on public.file_transfers for select to authenticated
using ((select auth.uid()) in (sender_id, recipient_id));

create policy "Members can propose files to fellow members"
on public.file_transfers for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and public.is_server_member(server_id)
  and exists (
    select 1 from public.channels c
    where c.id = file_transfers.channel_id and c.server_id = file_transfers.server_id
  )
  and exists (
    select 1 from public.server_members m
    where m.server_id = file_transfers.server_id and m.user_id = recipient_id
  )
);

create policy "Only transfer participants can read signaling"
on public.transfer_signals for select to authenticated
using ((select auth.uid()) in (from_user, to_user)
  and exists (
    select 1 from public.file_transfers t
    where t.id = transfer_id
      and ((t.sender_id = from_user and t.recipient_id = to_user)
        or (t.sender_id = to_user and t.recipient_id = from_user))
  ));

create policy "Participants may signal only one another"
on public.transfer_signals for insert to authenticated
with check (
  from_user = (select auth.uid())
  and exists (
    select 1 from public.file_transfers t
    where t.id = transfer_id
      and ((t.sender_id = from_user and t.recipient_id = to_user)
        or (t.sender_id = to_user and t.recipient_id = from_user))
  )
);

-- Realtime postgres_changes delivers INSERTS only to authorized participants.
-- Do not run twice: on re-run the publication line will report duplicate table.
alter publication supabase_realtime add table public.file_transfers;
alter publication supabase_realtime add table public.transfer_signals;

-- Notes: without a TURN relay, certain NAT/firewall pairs cannot connect.
-- Consider periodic database cleanup of stale signal rows in future.
