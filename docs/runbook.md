# Operator Runbook

This runbook covers the current supported target: DeepBook Predict on Sui Testnet. DeepBook Predict mainnet execution is intentionally out of scope until official mainnet contract and object IDs are available.

## Safety Boundaries

- Default dashboard, health, readiness, maintenance, reconcile, and backfill flows do not sign transactions.
- `deepbook:testnet dry-run:*` commands do not spend funds.
- `deepbook:testnet execute:*` commands spend Sui Testnet funds from the generated `.env` wallet.
- Connected-wallet UI execution requires wallet confirmation and should be treated as real Sui Testnet execution.
- Polymarket authenticated order submission remains disabled unless `POLYMARKET_ENABLE_LIVE_TRADING=true`, `POLYMARKET_LIVE_TRADING_APPROVED=true`, and manual confirmation controls are ready.

## Clean Start

```bash
pnpm install
docker compose up -d postgres
npm run db:migrate
WEB_PORT=3001 npm run dev:hybrid
```

Expected local services:

- Web: `http://localhost:3001`
- API: `http://localhost:4000`
- Postgres: `localhost:55433`

If a port is occupied, stop the old process or set `WEB_PORT` / `API_PORT` to a free port.

## Production-Like Local Stack

Use this path when validating restart behavior, container networking, migration startup, and deployment secrets:

```bash
npm run env:check -- production-like
docker compose -f docker-compose.production-like.yml up --build
```

Expected services:

- Web: `http://localhost:3001`
- API: `http://localhost:4000`
- Postgres host port: `localhost:55434`

The compose stack runs API migrations before starting the API. The Docker build excludes `.env` and `.env.*`; secrets are injected at runtime with `env_file`.

The Web container needs two API base URLs:

- `API_INTERNAL_BASE_URL=http://api:4000` for server-side rendering inside Docker.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000` for browser-side requests from the host.

Keep request timeouts finite with `API_REQUEST_TIMEOUT_MS`, otherwise a bad internal route can make the dashboard look like it is stuck loading.

## Pre-Flight Gates

Run these before handing the app to another operator or before pushing:

```bash
npm run env:check -- local
npm run secret:scan
npm run typecheck
npm run test
npm run lint
npm run build
git diff --check
```

Expected result: every command exits with code `0`.

## Environment Profiles

Local development:

```bash
npm run env:check -- local
```

Staging testnet:

```bash
VOLARB_ENV_PROFILE=staging npm run env:check
```

Production-like testnet:

```bash
VOLARB_ENV_PROFILE=production-like npm run env:check
```

All profiles keep `SUI_NETWORK=testnet`. `production-like` requires hybrid or real data mode, checks persistent database configuration, warns when maintenance is not scheduled, and refuses Polymarket live trading unless explicit operator approval is set.

## API Smoke

```bash
curl http://localhost:4000/api/health
curl 'http://localhost:4000/api/health?deep=1'
curl http://localhost:4000/api/source-statuses
curl http://localhost:4000/api/deepbook/readiness
curl http://localhost:4000/api/deepbook/positions
curl http://localhost:4000/api/maintenance/status
curl http://localhost:4000/api/polymarket/trading-readiness
curl http://localhost:4000/api/polymarket/btc-5m-monitor
curl http://localhost:4000/api/polymarket/account
curl -X POST http://localhost:4000/api/polymarket/order-preview \
  -H 'content-type: application/json' \
  --data '{"market":"btc-test","tokenId":"123","side":"buy","price":"0.42","size":"10"}'
curl -X POST http://localhost:4000/api/polymarket/cancel-preview \
  -H 'content-type: application/json' \
  --data '{"orderId":"0x0000000000000000000000000000000000000000000000000000000000000000"}'
curl -X POST http://localhost:4000/api/polymarket/order-execute \
  -H 'content-type: application/json' \
  --data '{"market":"btc-test","tokenId":"123","side":"buy","price":"0.42","size":"10","confirmation":"I understand this submits a real Polymarket order"}'
curl -X POST http://localhost:4000/api/polymarket/cancel-execute \
  -H 'content-type: application/json' \
  --data '{"orderId":"0x0000000000000000000000000000000000000000000000000000000000000000","confirmation":"I understand this cancels a real Polymarket order"}'
```

Expected result:

- `/api/health` returns API, database, and maintenance status without external source refresh.
- `/api/health?deep=1` includes source status.
- `/api/deepbook/readiness` reports Sui Testnet blockers and next action.
- `/api/polymarket/trading-readiness` never returns secret values.
- `/api/polymarket/btc-5m-monitor` returns a read-only BTC 5m window, Chainlink RTDS tick, Up/Down books, probability estimate, edge, and blockers. It does not require a Polymarket API key and does not sign or submit orders.
- `/api/polymarket/account` reads public Data API positions and, when L2 credentials are configured, reads CLOB collateral balance, allowances, and open orders with official CLOB L2 signing.
- `/api/polymarket/order-preview` calculates notional, max loss, max profit, collateral balance/allowance preflight, and blockers without signing or submitting an order.
- `/api/polymarket/cancel-preview` validates an order id against authenticated open orders when credentials are configured, but does not cancel.
- `/api/polymarket/order-execute` and `/api/polymarket/cancel-execute` should return `submitted=false` unless the live flag, explicit approval flag, credentials, Polygon chain id, notional cap, and exact manual confirmation text are all present.

## Polymarket L2 Credentials

Use this to check whether the configured Polygon/Polymarket wallet can derive CLOB L2 API credentials. The default command is read-only and does not call authenticated Polymarket endpoints:

```bash
pnpm --filter @vol-arb/api polymarket:credentials
```

Expected result:

- `privateKeyConfigured=true`
- `configuredWalletValid=true`
- `walletMatchesPrivateKey=true`
- `l2CredentialsConfigured=false` until credentials are created or configured

Only run credential creation intentionally. It signs L1 auth with the configured local private key and may create or derive API credentials at Polymarket:

```bash
pnpm --filter @vol-arb/api polymarket:credentials \
  --create-or-derive \
  --write-env .env
```

The command writes `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, and `POLYMARKET_API_PASSPHRASE` to an ignored local env file and does not print secret values. Use `--write-env .env.polymarket.local` instead if you want a staging file before updating the runtime `.env`. Keep `POLYMARKET_ENABLE_LIVE_TRADING=false` until authenticated account reads, order preview, risk review, and manual confirmation controls have been completed.

## BTC 5m Research Checkpoints

This workflow is research-only. It does not sign, submit, or cancel Polymarket orders.

Use the low-cost checkpoint while waiting for forward orderbook coverage:

```bash
pnpm btc5m:checkpoint:last
pnpm btc5m:checkpoint:last:current
pnpm btc5m:checkpoint:status
```

Expected result:

- `btc5m:checkpoint:last` only reads the latest saved local checkpoint report and does not run network checks, readiness, GA, or collectors. If `reportMatchesCurrentHead=false`, rerun `btc5m:checkpoint:status` before treating the status as current.
- `btc5m:checkpoint:last:current` exits non-zero if the latest saved checkpoint does not match the current clean HEAD.
- `summary.liveReady=false` until real orderbook coverage and GA acceptance pass.
- `summary.recommendedAction=keep_current_collector_running` when the active collector can cover the next weak Beijing segment.
- `summary.failedChecks` usually includes `orderbook_market_coverage`, `balanced_beijing_orderbook_segments`, and `execution_quality` while coverage is sparse.
- A full ignored JSON report is written under `.local/reports`.

Check the managed orderbook collector before changing it:

```bash
pnpm btc5m:orderbook:status
pnpm btc5m:orderbook:plan
```

Do not restart a healthy untargeted collector if `plan.recommendedAction` says
`keep_current_collector_running`; let it continue through the next weak Beijing segment.
Use `pnpm btc5m:orderbook:start:auto` only when no collector is running or when the plan
explicitly says to switch.

After orderbook coverage reaches the documented threshold, run the full checkpoint and
final gate:

```bash
pnpm btc5m:checkpoint
pnpm btc5m:checkpoint:gate
```

`btc5m:checkpoint:gate` exits non-zero unless `liveReady=true`. Treat a passing gate as a
research acceptance signal only; it is still not an order-submission command.

## Polymarket Small-Capital Gate

Use this section only after legal/risk approval and after the operator has intentionally funded the configured Polymarket wallet on Polygon mainnet. There is no Polymarket test trading sandbox in this repo.

Preconditions:

- `POLYMARKET_CHAIN_ID=137`.
- `POLYMARKET_WALLET_ADDRESS` matches the local signing key.
- `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, and `POLYMARKET_API_PASSPHRASE` are configured in an ignored env file.
- `/api/polymarket/account` returns `balanceAllowance.enabled=true`.
- Collateral balance and max allowance are greater than the intended order max loss.
- `POLYMARKET_MAX_LIVE_ORDER_USD` is set to the smallest useful smoke size.
- `POLYMARKET_ENABLE_LIVE_TRADING=true` and `POLYMARKET_LIVE_TRADING_APPROVED=true` are set only for the approved live run window.

Dry-run the exact order payload first:

```bash
curl -X POST http://localhost:4000/api/polymarket/order-preview \
  -H 'content-type: application/json' \
  --data '{"market":"<condition-or-slug>","tokenId":"<outcome-token-id>","side":"buy","price":"0.01","size":"1"}'
```

Continue only when:

- `orderSubmissionReady=true`.
- `blockers=[]`.
- `accountPreflight.balance` and `accountPreflight.maxAllowance` both cover `preview.maxLoss`.
- The market, outcome token, side, price, size, and max loss match the operator's intended manual trade.

Submit only with the exact confirmation text configured in `POLYMARKET_ORDER_CONFIRM_TEXT`:

```bash
curl -X POST http://localhost:4000/api/polymarket/order-execute \
  -H 'content-type: application/json' \
  --data '{"market":"<condition-or-slug>","tokenId":"<outcome-token-id>","side":"buy","price":"0.01","size":"1","confirmation":"I understand this submits a real Polymarket order"}'
```

After submission:

- Refresh `/api/polymarket/account`.
- Confirm the order appears in authenticated open orders or record the fill response.
- Cancel unintended open orders through `/api/polymarket/cancel-preview` and `/api/polymarket/cancel-execute` only after exact order-id verification and manual confirmation.
- Reset `POLYMARKET_ENABLE_LIVE_TRADING=false` after the approved run window.

Stop conditions:

- Chain id is not `137`.
- Any account, balance, allowance, or open-order read fails.
- The preview payload differs from the intended order.
- The notional exceeds `POLYMARKET_MAX_LIVE_ORDER_USD`.
- The operator cannot explain why the opportunity is `execute` instead of `watch` or `reject`.

## Optional BTC Price Provider

The default BTC spot adapter reads CoinGecko, Coinbase, and Kraken. For sustained usage or paid quota, configure an additional endpoint in the ignored runtime env file:

```bash
BTC_PRICE_API_BASE=https://provider.example/btc-usd
BTC_PRICE_API_HEADER_NAME=x-api-key
BTC_PRICE_API_HEADER_VALUE=<secret>
```

The provider response must include one of these fields: `price`, `usd`, `BTCUSD`, `last`, `rate`, `data.amount`, `data.price`, or `bitcoin.usd`. The adapter adds this configured source to the divergence check rather than replacing the free public sources.

## Browser Smoke

Run the committed Playwright smoke against the production-like web service:

```bash
E2E_BASE_URL=http://localhost:3001 pnpm run test:e2e --reporter=line
```

Expected result:

- Dashboard loads.
- Navigation anchors work.
- Opportunity table does not show `TRADE` before wallet dry-run gates.
- Polymarket account panel shows the collateral balance/allowance card.
- Maintenance panel still shows `NO SIGNING`.

## Sui Testnet Dry-Run

Use dry-run commands first:

```bash
pnpm --filter @vol-arb/api deepbook:testnet dry-run:deposit 0.1
pnpm --filter @vol-arb/api deepbook:testnet dry-run:mint 0.01 81000 up
pnpm --filter @vol-arb/api deepbook:testnet dry-run:redeem
pnpm --filter @vol-arb/api deepbook:testnet dry-run:withdraw 0.1
```

If dry-run fails, do not execute. Check:

- Sui gas balance.
- DUSDC wallet balance.
- PredictManager owner.
- Manager DUSDC balance.
- Active BTC OracleSVI candidate.
- Open positions and redeemable value.

## Sui Testnet Execute

Only run execute commands intentionally with disposable testnet funds:

```bash
pnpm --filter @vol-arb/api deepbook:testnet execute:deposit 0.1
pnpm --filter @vol-arb/api deepbook:testnet execute:mint 0.01 81000 up
pnpm --filter @vol-arb/api deepbook:testnet execute:redeem
pnpm --filter @vol-arb/api deepbook:testnet execute:withdraw 0.1
```

After execution:

```bash
curl http://localhost:4000/api/deepbook/reconcile
curl http://localhost:4000/api/deepbook/backfill
curl http://localhost:4000/api/deepbook/positions
```

Expected result: transaction lifecycle moves to `reconciled` or `failed` with an explainable failure reason.

## Connected Wallet Monitor

Use this while manually completing the Slush wallet acceptance flow in Chrome:

```bash
pnpm --filter @vol-arb/api deepbook:wallet-monitor \
  --owner 0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd \
  --manager 0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f \
  --watch \
  --interval 10
```

This is a read-only monitor. It prints JSON snapshots for manager readiness, OracleSVI candidate count, balances, open exposure, open positions, redeemable value, and withdraw readiness. It does not sign or submit transactions.

## Slush / Chrome State

Use this to verify or resume the connected-wallet path in Chrome.

Current known-good Slush testnet state:

- Owner: `0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd`
- PredictManager: `0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f`
- Manager DUSDC balance: `0 DUSDC`
- Wallet DUSDC balance after final withdraw: `19.997556 DUSDC`
- Open positions: `0`
- Open exposure: `0`
- Latest completed lifecycle: mint `9cvdVgSJc5m1eShyhvv6ijx4hbdPbDc11e1SKsG3THZW`, redeem `CA5PoCejdGGeAwwydZfARDC5BXdzAr4At86QK5xAouVc`, final withdraw `FkuuHYmaXxxp9qtZeQJya7MCxqseP8os7CweLKNPcVbz`.
- Next safe action: deposit DUSDC if another mint cycle is needed.

Non-destructive checks:

```bash
pnpm --filter @vol-arb/api deepbook:wallet-monitor \
  --owner 0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd \
  --manager 0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f
open -na 'Google Chrome' --args --new-window 'http://localhost:3001/#wallet'
```

If Chrome has no visible window or automation reports `cgWindowNotFound`, stop and ask the operator before quitting or restarting Chrome. Restarting Chrome can disrupt the operator's normal browser session.

For a new Slush lifecycle:

1. Open `http://localhost:3001/#wallet`.
2. Confirm Slush is unlocked, on Sui Testnet, and connected as `0xd123...1dcd`.
3. Deposit DUSDC into the manager.
4. Run wallet mint dry-run.
5. Sign mint only if dry-run passes and the prompt targets the DeepBook Predict Testnet package.
6. Wait for expiry, redeem, then withdraw only after `openPositions=0`, `openExposure=0`, and `canWithdrawQuote=true`.

## Maintenance

Manual maintenance:

```bash
curl -X POST http://localhost:4000/api/maintenance/run
```

Scheduled maintenance:

```bash
ENABLE_MAINTENANCE_SCHEDULER=true MAINTENANCE_INTERVAL_MS=60000 npm run dev:hybrid
```

Maintenance may refresh source status, check Postgres, reconcile local transaction records, and backfill configured wallet history. It does not sign or submit transactions.

Set `MAINTENANCE_TASK_TIMEOUT_MS` so one slow source cannot leave the operator panel permanently running. In production-like Docker this defaults to `20000`.

## Backup And Restore

Back up before schema changes or long testnet sessions:

```bash
npm run db:backup
```

Check that a dump is readable without touching any database:

```bash
npm run db:restore:check -- backups/<file>.dump
```

Restore only with explicit confirmation:

```bash
CONFIRM_RESTORE=volarb npm run db:restore -- backups/<file>.dump
```

Restore is destructive.

## Recovery Notes

- If UI state looks stale, run `Reconcile`, then `Backfill`, then refresh `Execution History`.
- If a transaction digest exists but local recording failed, the wallet UI queues it in browser storage and exposes retry.
- If Postgres is unavailable, the API falls back where possible but health and persistence should show degraded state. After a broken connection the API resets its pool on the next retry window.
- If the production-like dashboard shows `API connection failed`, check `API_INTERNAL_BASE_URL` in the Web container first.
- If Polymarket credentials are absent, the app should stay read-only.
- If DeepBook Predict mainnet IDs are unavailable, do not attempt mainnet execution.
- If mainnet support is published later, complete `docs/mainnet-migration-checklist.md` before adding or enabling any mainnet signing path.
