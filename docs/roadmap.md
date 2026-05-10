# Product Roadmap

DeepBook Predict is currently deployed on Sui Testnet only. This roadmap intentionally does not include a DeepBook Predict mainnet migration until Mysten publishes supported mainnet contracts, package IDs, and object IDs.

## Current Baseline

- Mock, hybrid, and real data modes exist.
- Real DeepBook Predict OracleSVI data is read from Sui Testnet.
- Polymarket public Gamma and CLOB data is read-only.
- BTC spot data uses free public sources with divergence checks.
- Postgres persistence stores snapshots, alerts, development simulation events, wallet-manager bindings, and chain transaction events.
- Wallet UI can build guarded Sui Testnet transactions.
- A local server-side Sui Testnet executor can dry-run or execute deposit, mint, redeem, and withdraw using the generated `.env` wallet.
- A full DeepBook Predict Sui Testnet lifecycle has been verified: deposit, mint, redeem, withdraw.

## Stage 1: Real User Wallet Flow

Goal: make the application usable by any connected Sui Testnet wallet without relying on the generated `.env` manager in the product UI.

Deliverables:

- Discover or persist the PredictManager owned by the connected wallet.
- Create a PredictManager when the wallet has none.
- Read wallet DUSDC, manager DUSDC, positions, exposure, redeemable value, and transaction history for the connected wallet.
- Gate every wallet transaction by owner match, gas, DUSDC, dry-run success, and current position state.
- Keep the generated-wallet executor as CLI-only developer tooling, not as a normal product path.

Exit criteria:

- A fresh Sui Testnet wallet can create a manager, deposit DUSDC, mint, redeem after expiry, and withdraw.
- A non-owner wallet can view state but cannot execute manager operations.

## Stage 2: Strategy Executability

Goal: only show executable opportunities when both strategy and protocol constraints agree.

Deliverables:

- Filter DeepBook Predict opportunities by active OracleSVI object, expiry, strike tick, direction, and dry-run success.
- Explain `reject`, `watch`, and `execute` decisions with exact blockers.
- Keep server-assembled opportunities in `watch` or `reject` until a connected wallet has passed an action-specific DeepBook Predict mint dry-run.
- Keep Polymarket data read-only while using it for comparison, pricing context, and hedge feasibility analysis.
- Size trades from edge, confidence, fees, slippage, gas, wallet balance, and manager exposure.

Exit criteria:

- Any `execute` opportunity can pass a DeepBook Predict mint dry-run before the UI enables wallet confirmation.
- The table never presents a non-dry-runnable mint as executable.

## Stage 3: Testnet Production Hardening

Goal: make repeated Sui Testnet usage reliable enough for external users and ongoing development.

Deliverables:

- Decode common Move aborts into user-readable reasons.
- Add retry-safe transaction recording and digest reconciliation.
- Add position lifecycle states for open, expired, redeemable, redeemed, failed, and unattributed positions.
- Add explicit operator alerts for stale oracle data, price feed divergence, RPC failures, and database degradation.
- Add per-wallet limits for max deposit, max mint size, max open exposure, and max loss.

Exit criteria:

- Failed transactions are explainable.
- Repeated full-cycle testnet runs do not leave stale UI state or orphaned local records.

## Stage 4: Operational Deployment

Goal: deploy a long-running service that is safe to operate while DeepBook Predict remains testnet-only.

Deliverables:

- Separate local, staging, and production-like testnet environments.
- Move secrets from local `.env` to deployment secret storage.
- Add CI gates for secret scanning, typecheck, test, lint, and build.
- Provide a local secret scanner that can be reused by CI before pushing or deploying.
- Add scheduled maintenance checks that reconcile transaction records, backfill configured wallet history, refresh source status, and avoid spending funds by default.
- Add authenticated Polymarket readiness checks while keeping live order submission behind explicit feature flags and manual confirmation.
- Add database migration, backup, and restore procedures.

Exit criteria:

- A clean deployment can recover after restart and show correct source, wallet, manager, alert, and position state.
- Scheduled maintenance checks validate integrations without spending funds unless explicit testnet execution is invoked separately.

## Stage 5: UX and Operator Workflow

Goal: make the product understandable without engineering explanation.

Deliverables:

- Replace the engineering-heavy wallet panel with a lifecycle flow: connect wallet, create manager, fund, mint, wait, redeem, withdraw.
- Keep advanced diagnostics available but secondary.
- Surface the next safe action and the exact reason an action is blocked.
- Add digest links, status timelines, and PnL attribution per position.

Exit criteria:

- A user can tell what can be done next, why, and what risk gate is active.

## Deferred Until Protocol Support

- DeepBook Predict mainnet migration.
- Mainnet DeepBook Predict execution.
- Polymarket authenticated CLOB trading.
- Automated cross-venue execution.

These are intentionally deferred because they require either protocol availability, separate credentials, additional legal/risk review, or a dedicated production trading design.
