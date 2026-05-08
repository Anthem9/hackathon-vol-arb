# Architecture

The project is a monorepo with clear boundaries:

```text
apps/web -> apps/api -> packages/adapters -> packages/core
```

`apps/web` consumes JSON from `apps/api`. React components do not import mock fixtures directly. `packages/core` owns deterministic calculations, while `packages/adapters` owns market-shaped data and future venue integration boundaries.

## Data Modes

- `mock`: deterministic fixtures only.
- `hybrid`: read real public services where available and fall back to mock data for unavailable pieces.
- `real`: require real services where currently supported; dry-run risk controls still prevent real order submission.

The API keeps a short real-data snapshot cache so one dashboard load reuses the same DeepBook, Polymarket, and BTC price reads across all route calls.

## Version 2 Read-Only Flow

```text
DeepBook Predict /oracles
  -> Sui testnet sui_getObject OracleSVI
  -> SVI surface normalization

Polymarket Gamma crypto market discovery
  -> CLOB book and midpoint reads
  -> opportunity scoring

CoinGecko + Coinbase BTC spot
  -> source divergence check
  -> overview and status panels
```

No adapter submits orders in Version 2. Opportunities can be scored, rejected, watched, or paper-traded only.
