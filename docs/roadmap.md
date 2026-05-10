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

## From Current State To Fully Usable Product

The target product is not a hackathon-only demo. The target is a real operator terminal that can safely run with real accounts, real data, explicit risk gates, and auditable transaction records. Hackathon submission assets are a packaging layer on top of that product, not a separate fake mode.

## Stage 1: Connected Wallet Acceptance

Goal: prove the real browser wallet path on Sui Testnet without relying on the generated `.env` manager in the product UI.

Deliverables:

- Discover or persist the PredictManager owned by the connected wallet.
- Create a PredictManager when the wallet has none.
- Read wallet DUSDC, manager DUSDC, positions, exposure, redeemable value, and transaction history for the connected wallet.
- Gate every wallet transaction by owner match, gas, DUSDC, dry-run success, and current position state.
- Keep the generated-wallet executor as CLI-only developer tooling, not as a normal product path.
- Record every wallet-signed transaction and reconcile it back from Sui Testnet.

Exit criteria:

- A fresh Sui Testnet wallet can create a manager, deposit DUSDC, mint, redeem after expiry, and withdraw.
- A non-owner wallet can view state but cannot execute manager operations.
- Browser refresh does not lose manager binding, transaction state, or blockers.

Current blocker:

- Slush connected-wallet manager creation is proven on Sui Testnet.
- Current Slush test wallet `0xd123...1dcd` owns PredictManager `0x3df8...411f`.
- Slush received 20 DUSDC and deposited 1 DUSDC into its manager with digest `6B6zh4...6g2T`.
- Slush mint dry-run now passes and is persisted through `/api/deepbook/mint-dry-runs`.
- `production-like` has an explicit Sui Testnet acceptance override for watch-only mint execution. This is not a fake mode: it still requires the real wallet, real Sui Testnet, real DeepBook Predict package, manager ownership, DUSDC, gas, risk limits, and a successful dry-run before wallet confirmation.
- Wallet mint construction now dry-runs active OracleSVI candidates and signs the first candidate accepted by the protocol. This avoids blocking on early active candidates that fail `pricing_config` or `assert_mintable_ask` aborts.
- Generated-wallet smoke execution has proven a full DeepBook Predict Testnet lifecycle: mint digest `Yi6WhLkHqMEN8A2ohN9qRt8DgtZu2rXUdTGsqaFdCZh`, redeem digest `5YUsHuYMUjua4r5wV6NEhSVe6PL5EmRvVEEHr8JL3NXs`, and withdraw digest `GdfYVCj2quGYUyLdRBsNuSGzQGRJ7rSpSAYB6cTLxcfN`.
- The generated-wallet manager ended with `trading_balance=0`, `open_exposure=0`, `open_positions=0`, and all generated-wallet positions marked `redeemed`.
- Slush withdrew 0.1 DUSDC from the manager with digest `9Fz2pt...Jm1R`.
- Signed mint and redeem acceptance remain pending for the Slush wallet path; local macOS UI automation is currently unable to attach to Chrome (`cgWindowNotFound`), so resume manually or after browser automation recovers.
- Resume from `docs/wallet-acceptance.md` Step 4.

## Stage 2: DeepBook Predict Testnet Product Hardening

Goal: make repeated DeepBook Predict Sui Testnet usage reliable enough for real operators.

Deliverables:

- Decode common Move aborts into user-readable reasons.
- Add retry-safe transaction recording and digest reconciliation.
- Add position lifecycle states for open, expired, redeemable, redeemed, failed, and unattributed positions.
- Add explicit operator alerts for stale oracle data, price feed divergence, RPC failures, DUSDC insufficiency, gas insufficiency, and database degradation.
- Add per-wallet limits for max deposit, max mint size, max open exposure, and max loss.
- Keep backup, restore, maintenance, health, reconcile, and backfill procedures documented and testable.

Exit criteria:

- Failed transactions are explainable.
- Repeated full-cycle testnet runs do not leave stale UI state or orphaned local records.
- Service restart can recover source, wallet, manager, alert, and position state from Postgres.

## Stage 3: Strategy Executability

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

## Stage 4: Polymarket Real Account Integration

Goal: move Polymarket from public-data/readiness mode toward controlled real-account operation.

Deliverables:

- Configure Polymarket wallet, funder, L2 key, secret, passphrase, and API access through secrets only.
- Verify account state, balances, positions, allowances, and open orders.
- Keep order preview and cancel preview as the first verified authenticated workflow.
- Add manual confirmation controls before any real order submission or cancellation.
- Add a live-trading feature gate that defaults to off in every environment.
- Add minimum-size real-account smoke tests only after credentials and legal/risk review are complete.

Exit criteria:

- Authenticated account and open-order reads are proven against the configured account.
- Order preview matches the eventual signed order payload before any live submission is enabled.
- The app cannot place or cancel Polymarket orders unless live trading, credentials, funding, and manual confirmation are all present.

## Stage 5: Small-Capital Real Operation

Goal: prove the full decision loop with tightly limited funds and manual approval.

Deliverables:

- Run fixed observation windows with real data and no automatic execution at first.
- Record every opportunity, blocker, manual decision, transaction, and realized result.
- Track PnL, slippage, gas, fees, stale-data rejects, and missed opportunities.
- Tune risk thresholds from real observations instead of mock assumptions.
- Keep manual confirmation for all fund-spending actions until repeated runs are stable.

Exit criteria:

- At least one complete small-capital loop is recorded and reconciled.
- The system can explain each `reject`, `watch`, and `execute` decision.
- No duplicate submissions or unsafe retries occur during failure recovery.

## Stage 6: Mainnet Readiness

Goal: be ready to migrate only after official DeepBook Predict mainnet package IDs, object IDs, asset types, and operational guidance exist.

Deliverables:

- Keep all package IDs, object IDs, asset types, RPC endpoints, and profile selection environment-driven.
- Add a mainnet profile that is read-only by default.
- Require the explicit checklist in `docs/mainnet-migration-checklist.md` before enabling mainnet signing.
- Re-run the connected-wallet lifecycle against official mainnet targets with minimum funds only after protocol support exists.

Exit criteria:

- Testnet and mainnet configuration cannot be mixed accidentally.
- Mainnet signing remains disabled until official protocol support and explicit operator approval exist.

## Stage 7: Final UX, Demo, And Submission

Goal: make the product feel polished while preserving operator clarity.

Deliverables:

- Replace engineering-heavy panels with a clear lifecycle flow: connect wallet, create manager, fund, mint, wait, redeem, withdraw.
- Keep advanced diagnostics available but secondary.
- Surface the next safe action and the exact reason an action is blocked.
- Add digest links, status timelines, and PnL attribution per position.
- Add opportunity radar, market comparison views, exposure controls, and risk-state indicators.
- Prepare hackathon submission material: demo script, short video path, deployment notes, architecture summary, and security notes.

Exit criteria:

- A user can tell what can be done next, why, and what risk gate is active.
- The demo path is stable, but no fake/test-only product mode is required for normal operation.

## Deferred Until Protocol Support

- DeepBook Predict mainnet migration.
- Mainnet DeepBook Predict execution.
- Automated cross-venue execution without manual confirmation.

These are intentionally deferred because they require either protocol availability, separate credentials, additional legal/risk review, or a dedicated production trading design.
