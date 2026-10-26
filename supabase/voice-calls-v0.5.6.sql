-- Mirlume v0.5.6: private DM voice-call signaling for WebRTC audio.
-- Run this once in Supabase SQL Editor, after direct-messages.sql.
-- This table stores temporary signaling metadata, NEVER actual microphone audio.

create table if not exists public.mirlume_call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null,
  conversation_id uuid not null references public.direct_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  signal_type text not null check (signal_type in ('offer','answer','candidate','hangup','decline')),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 32768),
  created_at timestamptz not null default now(),
  constraint mirlume_call_signals_different_people check (sender_id <> recipient_id)
);
create index if not exists mirlume_call_signals_recipient_recent
  on public.mirlume_call_signals(recipient_id, created_at desc);
create index if not exists mirlume_call_signals_call_id
  on public.mirlume_call_signals(call_id, created_at desc);

alter table public.mirlume_call_signals enable row level security;
drop policy if exists "Voice signaling only for DM participants" on public.mirlume_call_signals;
create policy "Voice signaling only for DM participants"
  on public.mirlume_call_signals for select to authenticated
  using (
    (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
    and exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id
        and (select auth.uid()) in (c.user_low, c.user_high)
    )
  );

drop policy if exists "DM participants send their own voice signals" on public.mirlume_call_signals;
create policy "DM participants send their own voice signals"
  on public.mirlume_call_signals for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id
        and (c.user_low = sender_id and c.user_high = recipient_id
          or c.user_high = sender_id and c.user_low = recipient_id)
    )
  );

revoke all on public.mirlume_call_signals from anon;
grant select, insert on public.mirlume_call_signals to authenticated;
grant usage, select on sequence public.mirlume_call_signals_id_seq to authenticated;

-- Prevent disclosure of calls through notifications to unrelated accounts.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'mirlume_call_signals'
  ) then
    alter publication supabase_realtime add table public.mirlume_call_signals;
  end if;
end $$;

-- Optional maintenance: run periodically to delete sensitive ICE metadata.
-- delete from public.mirlume_call_signals where created_at < now() - interval '1 day';
