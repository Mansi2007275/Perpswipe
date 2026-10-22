# PerpSwipe

**Perps for beginners on dreamDEX. See the most you can lose before you swipe.**

Swipe right to go long, left to go short. Every card shows a risk ticket first: the most
you can lose, the stop-loss price and the liquidation price, for both directions. Every
trade gets an on-chain stop-loss on dreamDEX, so it closes on its own even if you close
the app.

Built on [dreamDEX](https://app.testnet.dreamdex.io) perps, Somnia Tokyo testnet
(Hideki, chain 50383), with `@somnia-chain/markets-sdk`.

> Built for the dreamDEX Perps Builder Bounty (DoraHacks, Oct 19 – Nov 1 2026). Test money only.

## Who it is for

- New traders who want to try perps without getting liquidated on the first move
- Anyone on mobile who finds a full perps terminal too much
- dreamDEX: new users and volume on its perps markets

## Features

| Feature | How it works |
| --- | --- |
| Live market deck | Every perp market on dreamDEX, with live price, 24h change, 12h chart and funding |
| Risk ticket on every card | Most you can lose, stop-loss and liquidation price for long and short |
| Three risk levels | Steady 2x, Balanced 3x, Bold 5x; size 5, 10 or 25 USDso per trade |
| Swipe or tap to trade | Drag, buttons, or arrow keys. Nothing trades until you confirm |
| Confirm sheet with live price | Re-quotes from the order book before you sign |
| Auto margin top-up | Moves only the USDso the trade needs into your trading balance |
| On-chain stop-loss | Armed in dreamDEX's PerpStopOrderRegistry, fires via Somnia Reactivity |
| Positions with live PnL | Entry, mark, liquidation price, one-tap close (also cancels its stop) |
| Share card | `/api/card` makes a 1200×630 image of a trade for X |
| Test funds wizard | Mint USDso on Shannon, bridge USDso + STT to Hideki, move to trading |
| Daily streak | Days in a row with at least one trade, on the server when a database is configured, otherwise in your browser |
| On-chain proof list | Every tx hash from the session, ready for the README |
| Verified history | `/history`: every trade for your wallet, with its open, stop and close tx hashes |
| Leaderboard | `/leaderboard`: 7-day realised PnL, and how often a trade lost more than its risk ticket promised |
| Server-side proof | A trade is only recorded after the server fetches its receipt from Hideki and checks sender and pool |
| Stop-loss watcher | `/api/cron/sync` records a stop that fired while the app was closed |
| Plain-words hint | One sentence per card, only when an AI key is configured. No key, no hint — never invented text |

### The risk math

Liquidation estimate (same rule as the MarginBank: equity equals maintenance margin):

```
long  liquidation = entry × (1 − 1/leverage) / (1 − mm)
short liquidation = entry × (1 + 1/leverage) / (1 + mm)
```

`mm` is read live from dreamDEX's own `previewPerpLiquidationPrice` (2.5% on current
markets). The stop-loss sits halfway to your margin, so it always fires well before
liquidation. dreamDEX accounts are cross-margin, so extra balance only moves the real
liquidation price further away: the card shows the worst case. `npm run test:risk`
checks this against live markets.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

1. Install MetaMask (or any injected wallet) and connect. The app adds Hideki testnet.
2. Open **Get test funds** and follow the four steps (Shannon faucet, mint, bridge, move).
3. Back on **Trade**, pick a size and risk level, swipe a card, confirm.

Perps Arena balances live in a smart wallet on app.testnet.dreamdex.io, so they are not
visible to a browser wallet here. Use the funds wizard instead.

### Proof scripts (Node, no browser)

```bash
cp .env.example .env
npm run keygen        # testnet-only wallet in .env
npm run check         # list live perp markets
npm run fund          # mint on Shannon + bridge to Hideki (needs Shannon STT first)
npm run first-order   # open + close a small long, prints tx hashes
npm run test:risk     # risk math against live markets
```

## Project structure

```
app/
  page.tsx            trade screen: settings, deck, positions
  funds/page.tsx      test funds wizard
  api/card/route.tsx  share image for X
  providers.tsx       wagmi + React Query + SDK signer binding
components/
  SwipeDeck.tsx       drag, stamps, keyboard, card stack
  MarketCard.tsx      the card and its risk ticket
  ConfirmSheet.tsx    live quote, signing steps, tx hashes
  Positions.tsx       balances, open trades, close, share
  leaderboard/page.tsx  7-day realised PnL, and who stayed inside their risk ticket
  history/page.tsx      this wallet's verified trades, with tx hashes
  api/trades/           POST records a trade after verifying its receipt; GET reads a wallet's history
  api/trades/close/     POST records a close, with realised PnL read from the chain
  api/leaderboard/      top 20 wallets over the last 7 days
  api/streak/           server-side daily streak, bumped only for a verified trade
  api/cron/sync/        the stop-loss watcher (CRON_SECRET)
  api/hint/             one plain sentence per card (optional, needs AI_API_KEY)
lib/
  env.ts              every endpoint and key, validated with zod at startup
  chains.ts           Hideki + Shannon, with endpoints from env
  wagmi.ts            wallet connectors (injected, and WalletConnect when configured)
  dex.ts              every dreamDEX call (markets, quote, open, stop, close)
  risk.ts             pure risk math            (unit tests: lib/risk.test.ts)
  verify.ts           server-side receipt proof (unit tests: lib/verify.test.ts)
  markets-server.ts   perp pool lookup, read from the indexer over HTTP
  pnl-server.ts       realised PnL and fired stops, read from the indexer
  supabase.ts         anon client (read) and service-role client (write)
  ratelimit.ts        per-IP token bucket for the write routes
  record.ts           the browser's calls into the route handlers
  funds.ts            mint + bridge from Shannon
supabase/schema.sql   tables, indexes and RLS
scripts/              Node proof scripts
```

## Environment

Copy `.env.example` to `.env` and fill in what you want. The four endpoints already have
working defaults, so the app trades with an empty `.env`.

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `NEXT_PUBLIC_HIDEKI_RPC_URL` | everything | defaults to the public Hideki RPC |
| `NEXT_PUBLIC_HIDEKI_WS_URL` | chain reads through the SDK | defaults to the public Hideki WS |
| `NEXT_PUBLIC_SHANNON_RPC_URL` | the funds wizard | defaults to the public Shannon RPC |
| `NEXT_PUBLIC_DREAMDEX_INDEXER_URL` | markets, history, PnL | defaults to the dreamDEX indexer |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | the WalletConnect button | free at <https://cloud.reown.com> |
| `NEXT_PUBLIC_SUPABASE_URL` | history, leaderboard, server streak | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the same | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | the same (server only) | Supabase → Settings → API → reveal `service_role` |
| `CRON_SECRET` | the stop-loss watcher | any long random string you choose |
| `AI_API_KEY` | the per-card hint | an Anthropic or OpenAI key |
| `PRIVATE_KEY` | the `scripts/` proof scripts only | `npm run keygen` |

Nothing without the `NEXT_PUBLIC_` prefix ever reaches the browser. `NEXT_PUBLIC_` values
are inlined at build time, so restart `npm run dev` after changing one.

Without Supabase the app trades normally and simply hides history, the leaderboard and
the server streak rather than showing empty pages. Without `AI_API_KEY` the hint is
absent rather than invented.

### Database

Create a free Supabase project, then run all of `supabase/schema.sql` in its SQL editor.
It creates `trades` and `streaks` with row-level security: public read, no public write.
Every write goes through a route handler that first fetches the transaction receipt from
Hideki and checks that it succeeded, was sent by the wallet claiming it, and went to that
market's dreamDEX pool.

## Deploy

Push to GitHub, import the repo on Vercel, add the variables above in the project
settings, deploy. `vercel.json` runs the stop-loss watcher every 5 minutes; Vercel's
Hobby plan limits cron to one run a day, so on Hobby either upgrade or call
`/api/cron/sync?secret=…` from an external scheduler.

## Testing

`TESTING.md` is an end-to-end checklist to run with your own MetaMask, with a place to
paste each transaction hash for the proof table below.

```bash
npm run typecheck   # types
npm run build       # production build
npm test            # unit tests: risk math and receipt verification
npm run test:risk   # risk math against live Hideki markets
```

## Proof of work: live orders on Somnia Tokyo testnet

| # | Action | Market | Tx hash |
| --- | --- | --- | --- |
| 1 | | | |

Network: Hideki testnet, chain 50383, RPC `https://api.hideki2.infra.testnet.somnia.network`

## X posts

1. _link_
2. _link_
3. _link_

## Roadmap after the bounty

- Plain-words hint per card ("volatile today, smaller size suggested")
- Daily loss limit
- Leaderboard of trades that stayed within their risk ticket
- Mainnet launch when dreamDEX perps go live there
