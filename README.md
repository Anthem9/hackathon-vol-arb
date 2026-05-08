# DeepBook Predict Vol-Arb Intelligence Terminal

Research-only monorepo demo for normalizing DeepBook Predict OracleSVI and external BTC binary markets into comparable volatility surfaces, executable edge scores, risk decisions, and paper-trade PnL attribution.

## Current Scope

Version 1 uses deterministic mock data only.

Version 2 adds real read-only service integration:

- DeepBook Predict testnet indexed server and Sui testnet OracleSVI object reads
- Polymarket public Gamma market discovery and CLOB orderbook/midpoint reads
- BTC spot from two free sources, currently CoinGecko and Coinbase
- `DATA_MODE=mock|hybrid|real` switching with mock fallback
- Dry-run risk controls; no real order submission

## Workspace

- `apps/web`: Next.js dashboard
- `apps/api`: Node.js HTTP API
- `packages/core`: pricing, SVI, edge, risk, paper trading logic
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

Default services:

- Web: http://localhost:3000
- API: http://localhost:4000

If port 3000 is already occupied, set another web port:

```bash
WEB_PORT=3001 npm run dev:hybrid
```

Health checks:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/overview
curl http://localhost:4000/api/source-statuses
```

## Safety

This project is for research, analytics, simulation, and developer tooling only. It does not constitute investment advice, legal advice, or a recommendation to trade. Do not commit `.env.local`, private keys, wallet secrets, API keys, auth files, or real account credentials.
