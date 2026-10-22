# PerpSwipe end-to-end test

A real run with your own MetaMask on Somnia Tokyo (Hideki) testnet. Test money only.
Paste each transaction hash as you go — the tables at the bottom are the ones to copy
into the bounty README.

Hideki has no public block explorer. To check any hash yourself:

```bash
curl -s -X POST https://api.hideki2.infra.testnet.somnia.network \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0xYOUR_TX_HASH"]}'
```

`"status":"0x1"` means it succeeded. This is exactly the check `POST /api/trades` runs
on the server before it will save a row.

---

## 0. Before you start

```bash
cp .env.example .env     # then fill it in — see "Environment" in README.md
npm install
npm run typecheck        # must print nothing
npm run build            # must end with the route table, no errors
npm test                 # unit tests: risk math + receipt verification
npm run test:risk        # risk math against live Hideki markets
npm run dev              # http://localhost:3000
```

- [ ] All five commands above pass.

If you have not set up Supabase, the app still trades — the deck, the risk ticket, the
stop-loss and closing all work. History, the leaderboard and the server streak are
hidden instead of showing empty or invented data. Steps 6-9 below need Supabase.

### Supabase setup (needed for steps 6-9)

1. Create a free project at supabase.com.
2. SQL Editor → New query → paste all of `supabase/schema.sql` → Run.
3. Settings → API: copy the Project URL and the `anon` key, and reveal the
   `service_role` key.
4. Put them in `.env` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   and `SUPABASE_SERVICE_ROLE_KEY`. Restart `npm run dev`.

- [ ] `supabase/schema.sql` ran with no errors, and Table Editor shows `trades` and
      `streaks`.

---

## 1. Connect, and land on the right chain

- [ ] Open http://localhost:3000. The deck shows real markets with real prices.
- [ ] Click **Connect wallet**. With `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` set you get
      a choice of MetaMask or WalletConnect; without it, MetaMask connects directly.
- [ ] If MetaMask does not know Hideki, it offers to add chain 50383. Accept.
- [ ] Switch MetaMask to Ethereum Mainnet. The amber banner appears: *"Your wallet is on
      another network."* Click **Switch to Hideki** — it switches back.

## 2. Get test funds

Go to **Get test funds**.

- [ ] Step 1: the faucet link opens, and your Shannon STT balance shows on the page.
- [ ] Step 2: **Mint 200 USDso** — MetaMask switches to Shannon and asks you to sign.

      Mint tx: `________________________________________`

- [ ] Step 3: **Send 200 USDso** and **Send 1 STT for gas**. Wait one to three minutes.

      Bridge USDso tx: `________________________________________`
      Bridge STT tx:   `________________________________________`

- [ ] Step 4: switch to Hideki, press **Refresh** until the Hideki wallet balance shows
      the bridged USDso, then **Move all to trading**.

      Deposit tx: `________________________________________`

- [ ] Back on **Trade**, the right-hand panel shows a non-zero **Trading balance**.

## 3. Read the risk ticket before swiping

- [ ] Pick **10 USDso** and **Balanced 3x**.
- [ ] On the card: the amber ticket shows **Most you can lose**, and a stop-loss and
      liquidation price for both long and short.
- [ ] The long stop-loss price is **above** the long liquidation price. That is the whole
      promise: the stop fires first.
- [ ] Switch to **Bold 5x**. The stop and liquidation prices both move closer to the
      current price, and the most you can lose changes.

## 4. Open a long

- [ ] Swipe the card right (or press the **Long** button, or the right arrow key).
- [ ] The confirm sheet shows a freshly quoted fill price, size, your money in, the stop
      price, the liquidation price and the most you can lose.
- [ ] Press **Cancel**. Nothing is sent and the same card stays on top.
- [ ] Swipe right again and press **Open long**. Sign each MetaMask prompt (up to three:
      margin top-up if needed, the order, the stop-loss).
- [ ] The sheet reports the position opened **and** the stop-loss armed, each with a hash.

      Open tx:       `________________________________________`
      Stop-loss tx:  `________________________________________`

- [ ] Check both hashes with the `curl` above: `"status":"0x1"`.

## 5. See the stop armed on the position

- [ ] **Your trades** lists the position with its size, entry, live mark price, live PnL
      and liquidation price.
- [ ] The PnL number changes on its own within about 8 seconds.
- [ ] There is **no** "This trade has no stop-loss" warning, and no **Arm stop-loss**
      button — that pair only appears when the stop transaction failed.

### 5b. The retry path (optional, do it deliberately)

- [ ] Open a second trade and **reject** the third MetaMask prompt (the stop-loss one).
- [ ] The sheet says the position opened but the stop-loss was not armed.
- [ ] The position shows the red warning and an **Arm stop-loss** button.
- [ ] Press it, sign, and the warning goes away.

      Retry stop tx: `________________________________________`

## 6. The row reaches Supabase

- [ ] Supabase → Table Editor → `trades`. One row for the trade from step 4.
- [ ] `open_tx` and `stop_tx` match the hashes you pasted above.
- [ ] `status` is `open`, `closed_at` is empty.
- [ ] `max_loss`, `stop_price` and `liq_price` match what the confirm sheet showed.

### The verification actually rejects things

Try to forge a trade. All three must be refused:

```bash
# 1. A hash that is not on Hideki
curl -s -X POST http://localhost:3000/api/trades -H 'content-type: application/json' \
  -d '{"openTx":"0x1111111111111111111111111111111111111111111111111111111111111111",
       "wallet":"0xYOUR_WALLET","symbol":"ETH/USDso:USDso","side":"long","leverage":3,
       "plan":{"qty":1,"price":2000,"margin":10,"stopPrice":1900,"liquidationPrice":1700,"maxLoss":5}}'

# 2. Your real open tx, but claimed by a different wallet
curl -s -X POST http://localhost:3000/api/trades -H 'content-type: application/json' \
  -d '{"openTx":"0xYOUR_REAL_OPEN_TX",
       "wallet":"0x000000000000000000000000000000000000dEaD","symbol":"ETH/USDso:USDso",
       "side":"long","leverage":3,
       "plan":{"qty":1,"price":2000,"margin":10,"stopPrice":1900,"liquidationPrice":1700,"maxLoss":5}}'

# 3. A real Hideki tx that did not go to a dreamDEX pool (use your bridge or mint tx)
curl -s -X POST http://localhost:3000/api/trades -H 'content-type: application/json' \
  -d '{"openTx":"0xYOUR_DEPOSIT_TX","wallet":"0xYOUR_WALLET","symbol":"ETH/USDso:USDso",
       "side":"long","leverage":3,
       "plan":{"qty":1,"price":2000,"margin":10,"stopPrice":1900,"liquidationPrice":1700,"maxLoss":5}}'
```

- [ ] 1 returns `"That transaction is not on Hideki yet..."`
- [ ] 2 returns `"That transaction was not sent by this wallet."`
- [ ] 3 returns `"That transaction did not go to this market's dreamDEX pool."`
- [ ] No new rows appeared in `trades` from any of them.

## 7. Close it

- [ ] Press **Close** on the position. Sign in MetaMask.
- [ ] The toast confirms the close with a hash.

      Close tx: `________________________________________`

- [ ] The position disappears from **Your trades** within a refresh or two.
- [ ] In Supabase, the same row now has `close_tx`, a `close_price`, a `pnl` and
      `status = closed`, with `closed_at` set.
- [ ] The `pnl` sign matches what you saw: profit positive, loss negative.

> If the close toast says the result could not be saved and mentions the indexer, the
> close is on-chain but dreamDEX has not indexed it yet. Press **Close** on nothing —
> instead wait ~15s and let the cron in step 9 pick it up, or re-run:
> `curl -s -X POST http://localhost:3000/api/trades/close -H 'content-type: application/json' -d '{"openTx":"0x…","closeTx":"0x…"}'`

## 8. History, streak and leaderboard

- [ ] **History** lists the trade: side, size, entry, close price, PnL, what the risk
      ticket promised, and all three transaction hashes.
- [ ] `status` reads *"You closed it"*.
- [ ] A **1-day streak** chip shows in the header.
- [ ] `curl -s "http://localhost:3000/api/streak?wallet=0xYOUR_WALLET"` returns
      `{"ok":true,"days":1}`.
- [ ] **Leaderboard** lists your wallet with the PnL from step 7.
- [ ] **Past max loss** reads `none` — your loss (if any) stayed inside the risk ticket.
      This is the number PerpSwipe is actually trying to win on.

## 9. The stop-loss watcher

The watcher is what records a stop-loss that fires while the app is closed.

- [ ] Open a trade and leave it open. Close the browser tab.
- [ ] Run the cron by hand:

```bash
curl -s "http://localhost:3000/api/cron/sync?secret=$CRON_SECRET"
```

- [ ] It answers with `openTrades`, and `checked` lists your trade as `still open`.
- [ ] Now close that position (reopen the app, press **Close**) and run the cron again,
      or wait for a stop to fire. The row ends as `closed` or `stopped`, with a
      `close_price` and a `pnl`.
- [ ] Without the secret, `curl -s http://localhost:3000/api/cron/sync` returns
      `"Not authorised."` with status 401.

> On Vercel, `vercel.json` runs this every 5 minutes. Cron on the Hobby plan is limited
> to one run per day — on Hobby either upgrade or call the URL from an external
> scheduler with the `CRON_SECRET` in the query string.

## 10. The hint (only with AI_API_KEY)

- [ ] With `AI_API_KEY` unset: the confirm sheet shows **no** hint line at all. Nothing
      invented, no placeholder.
- [ ] With `AI_API_KEY` set: a single short sentence appears above the signing note.
- [ ] Open the same card twice within 10 minutes — the second is served from cache
      (`curl -s -X POST http://localhost:3000/api/hint -H 'content-type: application/json'
      -d '{"symbol":"ETH/USDso:USDso","change24h":0.01,"fundingRate":0.0001,"closes":[]}'`
      returns `"cached":true` on the second call).

## 11. Rate limiting

```bash
for i in $(seq 1 25); do \
  curl -s -o /dev/null -w "%{http_code} " -X POST http://localhost:3000/api/trades \
    -H 'content-type: application/json' -d '{}'; done; echo
```

- [ ] The first 20 answer the same code (`400` for the bad body once Supabase is set up,
      `503` before that), and every one after answers `429` with a `retry-after` header.

---

## Proof of work: paste these into the bounty README

| # | Action | Market | Tx hash |
| --- | --- | --- | --- |
| 1 | Mint 200 USDso (Shannon) | — | |
| 2 | Bridge USDso to Hideki | — | |
| 3 | Bridge STT to Hideki | — | |
| 4 | Deposit margin | | |
| 5 | **Open long** | | |
| 6 | **Stop-loss armed** | | |
| 7 | **Close** | | |
| 8 | Open short (optional) | | |
| 9 | Stop-loss armed (optional) | | |
| 10 | Close (optional) | | |

Network: Hideki testnet, chain 50383, RPC `https://api.hideki2.infra.testnet.somnia.network`

### Anything that did not work

| Step | What happened | Hash if any |
| --- | --- | --- |
| | | |
