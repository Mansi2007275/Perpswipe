-- PerpSwipe database. Run this once in the Supabase SQL editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- Every row here is written only by a Next.js route handler that has already
-- verified the transaction receipt on Hideki. The browser never writes.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- trades

create table if not exists public.trades (
  id          uuid primary key default gen_random_uuid(),
  wallet      text        not null,
  symbol      text        not null,
  side        text        not null check (side in ('long', 'short')),
  qty         numeric     not null,
  entry_price numeric     not null,
  margin      numeric     not null,
  leverage    int         not null,
  stop_price  numeric,
  liq_price   numeric,
  max_loss    numeric,
  open_tx     text        not null unique,
  stop_tx     text,
  close_tx    text,
  close_price numeric,
  pnl         numeric,
  status      text        not null check (status in ('open', 'closed', 'stopped')),
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz
);

-- The leaderboard sums pnl per wallet over closed trades in a time window, and
-- /history reads one wallet newest-first.
create index if not exists trades_wallet_opened_idx on public.trades (wallet, opened_at desc);
create index if not exists trades_closed_at_idx     on public.trades (closed_at desc) where closed_at is not null;
create index if not exists trades_status_idx        on public.trades (status);

-- ---------------------------------------------------------------- streaks

create table if not exists public.streaks (
  wallet   text primary key,
  days     int  not null default 0,
  last_day date
);

-- ---------------------------------------------------------------- RLS
-- Public read so the leaderboard and a wallet's history work from the browser
-- with the anon key. No public write: inserts and updates go through the route
-- handlers, which use the service role key and verify the receipt first.

alter table public.trades  enable row level security;
alter table public.streaks enable row level security;

drop policy if exists "trades are public to read"  on public.trades;
drop policy if exists "streaks are public to read" on public.streaks;

create policy "trades are public to read"  on public.trades  for select using (true);
create policy "streaks are public to read" on public.streaks for select using (true);

-- No insert/update/delete policy exists on purpose. With RLS on, the anon and
-- authenticated roles therefore cannot write at all, while the service role
-- bypasses RLS entirely.
revoke insert, update, delete on public.trades  from anon, authenticated;
revoke insert, update, delete on public.streaks from anon, authenticated;
