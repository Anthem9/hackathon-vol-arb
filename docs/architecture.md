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

## DeepBook Predict Network Boundary

DeepBook Predict is treated as a Sui Testnet execution venue. There is no DeepBook Predict mainnet execution path in this codebase because the protocol is currently testnet-only.

Mainnet-related work is limited to read-only external context, such as public BTC and Polymarket market data. Any future DeepBook Predict mainnet support must be a separate migration after official mainnet package IDs, object IDs, asset types, and operational guidance are available.

## Current Data And Execution Flow

```text
DeepBook Predict /oracles
  -> Sui testnet sui_getObject OracleSVI
  -> SVI surface normalization

Polymarket Gamma crypto market discovery
  -> CLOB book and midpoint reads
  -> opportunity scoring

Configured BTC price endpoint + CoinGecko + Coinbase + Kraken BTC spot
  -> source divergence check
  -> overview and status panels

Postgres
  -> dashboard_snapshots
  -> source_status_snapshots
  -> alert_events
  -> wallet_manager_bindings
  -> deepbook_chain_transactions
  -> paper_trade_events (developer simulation only)

Sui Wallet
  -> dApp Kit testnet connection
  -> PredictManager create transaction
  -> guarded testnet deposit / mint / redeem / withdraw

Server Testnet Executor
  -> local generated wallet from .env
  -> dry-run or explicit testnet smoke execution
  -> chain transaction event persistence
```

Polymarket contributes comparison markets, external prices, account/open-order reads, and guarded execution controls. Authenticated order and cancel submission are blocked by default unless live flags, explicit approval, L2 credentials, Polygon mainnet, notional limits, and exact manual confirmation text all pass.

## Product Direction

The next architecture step is current-wallet ownership:

- Detect the connected wallet's PredictManager.
- Persist wallet-to-manager bindings.
- Load positions and balances for the connected wallet, not only the configured generated wallet.
- Keep generated-wallet execution in CLI-only developer tooling.
- Let the UI execute only wallet-signed Sui Testnet transactions for the connected wallet.

See `docs/roadmap.md` for the stage plan.
