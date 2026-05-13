# DeepBook Predict Vol-Arb Intelligence Terminal

Monorepo for normalizing DeepBook Predict OracleSVI and external BTC binary markets into comparable volatility surfaces, executable edge scores, risk decisions, and position lifecycle controls.

DeepBook Predict is currently available on Sui Testnet only. The product roadmap therefore treats Sui Testnet as the real execution environment for DeepBook Predict until Mysten publishes mainnet contract and object IDs. Mainnet migration is not a current deliverable.

## Current Scope

Version 1 uses deterministic mock data only.

Version 2 adds real read-only service integration:

- DeepBook Predict testnet indexed server and Sui testnet OracleSVI object reads
- Polymarket public Gamma market discovery and CLOB orderbook/midpoint reads
- Polymarket BTC 5m read-only monitor using Chainlink BTC/USD RTDS settlement ticks, Gamma window discovery, and CLOB Up/Down order books
- BTC spot from free public sources plus an optional configured paid or higher-quota endpoint
- `DATA_MODE=mock|hybrid|real` switching with mock fallback
- Dry-run risk controls before wallet confirmation
- Postgres persistence for dashboard snapshots, source status snapshots, alert events, and DeepBook chain transaction events
- Alert engine for source failures, SVI staleness, risk controls, and edge thresholds
- Sui wallet connection UI with guarded DeepBook Predict testnet deposit, mint, redeem, and withdraw flows
- Server-side testnet smoke executor for local regression testing with the generated `.env` wallet

Version 3 focuses on real testnet usability rather than mainnet migration:

- Current-wallet PredictManager lifecycle instead of a single configured manager
- Strategy outputs constrained by DeepBook Predict testnet dry-run success
- Position lifecycle, risk gates, alerts, and operator controls hardened for repeated use
- Polymarket has authenticated account, preview, and live execution controls, with execution disabled unless explicit live flags and manual confirmation are present

## Workspace

- `apps/web`: Next.js dashboard
- `apps/api`: Node.js HTTP API
- `packages/core`: pricing, SVI, edge, risk, and development simulation logic
- `packages/adapters`: mock, DeepBook, Polymarket, BTC price, and real dashboard adapters
- `packages/config`: shared constants
- `crates/vol-engine`: optional Rust scaffold

## Run

```bash
pnpm install
npm run build
npm run dev
```

Hybrid read-only mode:

```bash
npm run dev:hybrid
```

Local Postgres for persistence:

```bash
docker compose up -d postgres
npm run db:migrate
```

Production-like local stack:

```bash
npm run env:check -- production-like
docker compose -f docker-compose.production-like.yml up --build
```

This starts Postgres, runs API migrations, serves the API on `http://localhost:4000`, and serves the built web app on `http://localhost:3001`. The Docker build context excludes `.env` and `.env.*`; secrets are provided only at container runtime through `env_file`.

Back up and restore local Postgres:

```bash
npm run db:backup
CONFIRM_RESTORE=volarb npm run db:restore -- backups/<file>.dump
```

`db:restore` is destructive and refuses to run without `CONFIRM_RESTORE=volarb`.

Default services:

- Web: http://localhost:3000
- API: http://localhost:4000

If port 3000 is already occupied, set another web port:

```bash
WEB_PORT=3001 npm run dev:hybrid
```

Health checks:

```bash
npm run env:check -- local
curl http://localhost:4000/api/health
curl 'http://localhost:4000/api/health?deep=1'
curl http://localhost:4000/api/overview
curl http://localhost:4000/api/source-statuses
curl http://localhost:4000/api/alerts
curl http://localhost:4000/api/persistence
```

DeepBook Predict testnet smoke checks:

```bash
pnpm --filter @vol-arb/api deepbook:testnet dry-run:deposit 0.1
pnpm --filter @vol-arb/api deepbook:testnet dry-run:mint 0.01 81000 up
pnpm --filter @vol-arb/api deepbook:testnet dry-run:redeem
pnpm --filter @vol-arb/api deepbook:testnet dry-run:withdraw 0.1
```

Maintenance checks are dry-run/status-only by default. They reconcile local DeepBook transaction records, backfill configured wallet history, refresh source status, and check Postgres:

```bash
curl http://localhost:4000/api/maintenance/status
curl -X POST http://localhost:4000/api/maintenance/run
```

To run them periodically inside the API process:

```bash
ENABLE_MAINTENANCE_SCHEDULER=true MAINTENANCE_INTERVAL_MS=60000 npm run dev:hybrid
```

Polymarket authenticated trading readiness is exposed without submitting orders:

```bash
curl http://localhost:4000/api/polymarket/trading-readiness
curl http://localhost:4000/api/polymarket/btc-5m-monitor
curl http://localhost:4000/api/polymarket/account
curl -X POST http://localhost:4000/api/polymarket/order-preview \
  -H 'content-type: application/json' \
  --data '{"market":"btc-test","tokenId":"123","side":"buy","price":"0.42","size":"10"}'
curl -X POST http://localhost:4000/api/polymarket/cancel-preview \
  -H 'content-type: application/json' \
  --data '{"orderId":"0x0000000000000000000000000000000000000000000000000000000000000000"}'
```

Live Polymarket submission endpoints exist at `/api/polymarket/order-execute` and `/api/polymarket/cancel-execute`, but default to blocked. Set `POLYMARKET_ENABLE_LIVE_TRADING=true` and `POLYMARKET_LIVE_TRADING_APPROVED=true` only after API credentials, signing wallet, funding, per-order notional limits, and manual confirmation controls are ready.

The BTC 5m monitor is not a trading endpoint. It scans the current `btc-updown-5m-{window}` Gamma event, reads the public CLOB books for Up/Down, subscribes to `crypto_prices_chainlink` `btc/usd` on Polymarket RTDS, and displays probability/edge diagnostics on the dashboard. It requires no Polymarket API key.

Environment profiles:

```bash
npm run env:check -- local
npm run env:check -- staging
npm run env:check -- production-like
```

`production-like` still means DeepBook Predict Sui Testnet execution. The environment checker refuses Sui mainnet execution and refuses Polymarket live trading unless explicit operator approval is set.

Use `execute:*` only on Sui Testnet with disposable test funds:

```bash
pnpm --filter @vol-arb/api deepbook:testnet execute:deposit 0.1
```

## Safety

This project does not constitute investment advice, legal advice, or a recommendation to trade. DeepBook Predict transaction execution is limited to Sui Testnet while the protocol is testnet-only. Do not commit `.env.local`, private keys, wallet secrets, API keys, auth files, or real account credentials.

For handoff and operational checks, use [docs/runbook.md](docs/runbook.md). For connected wallet acceptance, use [docs/wallet-acceptance.md](docs/wallet-acceptance.md). For the current evidence-based completion status, use [docs/completion-audit.md](docs/completion-audit.md).
