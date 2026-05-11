# Operator Runbook

This runbook covers the current supported target: DeepBook Predict on Sui Testnet. DeepBook Predict mainnet execution is intentionally out of scope until official mainnet contract and object IDs are available.

## Safety Boundaries

- Default dashboard, health, readiness, maintenance, reconcile, and backfill flows do not sign transactions.
- `deepbook:testnet dry-run:*` commands do not spend funds.
- `deepbook:testnet execute:*` commands spend Sui Testnet funds from the generated `.env` wallet.
- Connected-wallet UI execution requires wallet confirmation and should be treated as real Sui Testnet execution.
- Polymarket authenticated order submission remains disabled unless `POLYMARKET_ENABLE_LIVE_TRADING=true` and manual confirmation controls are ready.

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

All profiles keep `SUI_NETWORK=testnet`. `production-like` requires hybrid or real data mode, checks persistent database configuration, warns when maintenance is not scheduled, and refuses Polymarket live trading until explicit order controls exist.

## API Smoke

```bash
curl http://localhost:4000/api/health
curl 'http://localhost:4000/api/health?deep=1'
curl http://localhost:4000/api/source-statuses
curl http://localhost:4000/api/deepbook/readiness
curl http://localhost:4000/api/deepbook/positions
curl http://localhost:4000/api/maintenance/status
curl http://localhost:4000/api/polymarket/trading-readiness
curl http://localhost:4000/api/polymarket/account
curl -X POST http://localhost:4000/api/polymarket/order-preview \
  -H 'content-type: application/json' \
  --data '{"market":"btc-test","tokenId":"123","side":"buy","price":"0.42","size":"10"}'
curl -X POST http://localhost:4000/api/polymarket/cancel-preview \
  -H 'content-type: application/json' \
  --data '{"orderId":"0x0000000000000000000000000000000000000000000000000000000000000000"}'
```

Expected result:

- `/api/health` returns API, database, and maintenance status without external source refresh.
- `/api/health?deep=1` includes source status.
- `/api/deepbook/readiness` reports Sui Testnet blockers and next action.
- `/api/polymarket/trading-readiness` never returns secret values.
- `/api/polymarket/account` reads public Data API positions and, when L2 credentials are configured, reads CLOB open orders with official CLOB L2 signing. Cancel remains disabled.
- `/api/polymarket/order-preview` calculates notional, max loss, max profit, and blockers without signing or submitting an order.
- `/api/polymarket/cancel-preview` validates an order id against authenticated open orders when credentials are configured, but does not cancel.

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

## Browser Smoke

Use the temporary Playwright harness if it exists:

```bash
cd /tmp/volarb-e2e
npx playwright test dashboard-smoke.spec.js --config empty.config.js --reporter=line
```

Expected result:

- Dashboard loads.
- Navigation anchors work.
- Opportunity table does not show `TRADE` before wallet dry-run gates.
- Execution reconcile/backfill buttons complete.
- Maintenance run completes and still shows `NO SIGNING`.

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
