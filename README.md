# DeepBook Predict Vol-Arb Intelligence Terminal

Research-only monorepo demo for normalizing DeepBook Predict OracleSVI and external BTC binary markets into comparable volatility surfaces, executable edge scores, risk decisions, and paper-trade PnL attribution.

## Version 1 Scope

This version uses deterministic mock data only. It does not connect to real trading services, wallets, API keys, or real-money execution.

## Workspace

- `apps/web`: Next.js dashboard
- `apps/api`: Node.js HTTP API
- `packages/core`: pricing, SVI, edge, risk, paper trading logic
- `packages/adapters`: mock data plus DeepBook / Polymarket adapter boundaries
- `packages/config`: shared constants
- `crates/vol-engine`: optional Rust scaffold

## Run

```bash
pnpm install
npm run build
npm run dev
```

Default services:

- Web: http://localhost:3000
- API: http://localhost:4000

Health checks:

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/overview
```

## Safety

This project is for research, analytics, simulation, and developer tooling only. It does not constitute investment advice, legal advice, or a recommendation to trade. Do not commit `.env.local`, private keys, wallet secrets, API keys, auth files, or real account credentials.
