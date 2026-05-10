# Real Integration Checklist

This checklist is the handoff from the mock demo to real-service integration. DeepBook Predict is currently testnet-only, so production work means hardening the Sui Testnet flow rather than migrating DeepBook Predict to mainnet. Do not commit private keys, mnemonics, API secrets, passphrases, keystores, or `.env`.

## Local Secrets

- Keep all generated private keys and provider tokens in local `.env`.
- Commit only `.env.example`, with variable names and safe public defaults.
- Never paste wallet private keys, mnemonics, CLOB API secrets, or Ankr tokens into issues, PRs, README files, screenshots, or demo recordings.
- Run `npm run env:check -- local`, `npm run env:check -- staging`, or `npm run env:check -- production-like` before handoff. The checker enforces the Sui Testnet boundary and keeps Polymarket live trading disabled.

## Sui Testnet

- Network: Sui Testnet.
- Funding target: generated local `SUI_TESTNET_ADDRESS` in `.env`.
- Test funds needed: start with 10 test SUI for wallet flows, repeated object reads, deposits, and failed transaction retries.
- DUSDC is required for deposit and mint tests.
- RPC strategy:
  - Prefer testnet gRPC for new Sui integration work where SDK support is ready.
  - Keep testnet HTTPS RPC configured as a fallback while the ecosystem migration continues.
- DeepBook Predict public testnet integration values are in `.env.example`:
  - Predict server URL
  - Predict package ID
  - Predict registry ID
  - Predict object ID
  - DUSDC quote asset type and currency ID
- Current execution task: choose an active BTC OracleSVI candidate that passes a DeepBook Predict mint dry-run. The executor tries active candidates in order.

## Polygon / Polymarket

- Network for local wallet testing: Polygon Amoy.
- Funding target: generated local `POLYGON_TEST_ADDRESS` in `.env`.
- Test funds needed: 1-2 Amoy POL is enough for wallet/RPC/signing tests; request more only if deploying or writing contracts.
- Faucet options:
  - Alchemy Polygon Amoy faucet
  - QuickNode Polygon faucet
  - GetBlock faucet
  - StakePool faucet
- Polymarket data:
  - Gamma API is public and does not require authentication for market discovery.
  - Data API is public and does not require authentication for public activity/positions style data.
  - CLOB read endpoints are public for orderbook, prices, spreads, and price history.
- Polymarket trading:
  - Authenticated CLOB endpoints require L2 API credentials.
  - L2 credentials are created or derived by signing with the wallet private key via the official CLOB SDK.
  - Builder API keys are separate credentials for builder/relayer attribution and are created in the Polymarket builder settings page.
  - `/api/polymarket/trading-readiness` verifies CLOB reachability, L2 credentials, wallet signing material, optional funder address, and the live-trading feature flag without returning secrets.
  - `/api/polymarket/account` reads public Data API positions for the configured wallet and reads authenticated CLOB open orders with backend L2 HMAC signing when credentials are configured.
  - `/api/polymarket/order-preview` calculates notional, max loss, max profit, and blockers without signing or submitting an order.
  - `/api/polymarket/cancel-preview` validates an order id against authenticated open orders when credentials are configured, but does not cancel.
- Production caveat: Polymarket trading is on Polygon mainnet. Treat Amoy as wallet/RPC/signing rehearsal, not a real Polymarket trading sandbox, unless Polymarket publishes a separate test trading environment.

## Price Sources

- Start with free public BTC spot feeds:
  - CoinGecko public simple price API
  - Coinbase public exchange products
  - Kraken public market data
- Use at least two sources in Version 2 and mark the price feed stale if they diverge beyond a configured threshold.
- Keep paid API keys optional until rate limits block real testing.

## Current Exit Criteria

- Mock mode still works.
- Hybrid read-only mode can fetch:
  - Sui/DeepBook Predict status and oracle list.
  - DeepBook Predict BTC oracle or market state.
  - Polymarket BTC-related markets and CLOB prices.
  - BTC spot from at least two free sources.
- Hybrid mode can compare real surfaces with mock fallback when one source is stale.
- Sui Testnet DeepBook Predict deposit, mint, redeem, and withdraw can be dry-run.
- Sui Testnet DeepBook Predict deposit, mint, redeem, and withdraw can be executed intentionally with the generated test wallet.
- Wallet UI blocks non-owner wallets from manager operations.
- Polymarket authenticated trading and mainnet execution remain disabled.

## Implementation Status

- `DATA_MODE=mock|hybrid|real` is wired through the API.
- `DeepBookPredictAdapter` reads `/oracles` and Sui testnet `sui_getObject` for real BTC OracleSVI objects.
- `PolymarketAdapter` reads Gamma market discovery plus public CLOB book and midpoint endpoints.
- `BtcPriceAdapter` reads CoinGecko, Coinbase, and Kraken, then reports source divergence.
- `RealDashboardAdapter` assembles a read-only research terminal payload with mock fallback.
- Server-side opportunities stay `watch` or `reject` until a connected wallet-specific DeepBook Predict dry-run succeeds.
- `/api/source-statuses` exposes source health and fallback state to the dashboard.
- `/api/health` exposes lightweight API, database, and maintenance state; `/api/health?deep=1` also refreshes external source status.
- Postgres persists source snapshots, dashboard snapshots, alerts, wallet-manager bindings, and chain transaction events.
- Root `db:backup` and guarded `db:restore` scripts provide local Postgres backup and recovery procedures.
- The Sui wallet panel builds guarded testnet deposit, mint, redeem, and withdraw transactions for the connected wallet.
- The Sui wallet panel enforces configurable per-wallet deposit, mint, and open-exposure limits from `NEXT_PUBLIC_MAX_*_DUSDC`.
- The API can discover a connected wallet's owned PredictManager from Sui Testnet and persist the binding after owner verification.
- The API package includes a CLI-only Sui Testnet executor for smoke tests.
- The API package includes a read-only connected-wallet monitor for Slush/manual signing acceptance evidence.
- The API exposes dry-run/status-only maintenance endpoints for source refresh, Postgres check, transaction reconcile, and configured-wallet backfill.
- The dashboard exposes Polymarket authenticated trading readiness while keeping order submission read-only unless explicitly enabled.
- The dashboard exposes public Polymarket wallet positions, authenticated open orders when L2 credentials are configured, and cancel-order gates.
- The dashboard exposes a Polymarket order preview panel for risk calculation only; it does not sign or submit orders.
- The dashboard exposes a Polymarket cancel preview panel; it does not submit cancel requests.
- A full Sui Testnet lifecycle has been verified with real testnet transactions.
- Slush connected-wallet manager creation, deposit, mint dry-run, idle withdraw, and read-only monitoring have been verified; signed mint/redeem are pending Chrome recovery or manual wallet signing.
- Polymarket authenticated trading is still disabled.
- DeepBook Predict mainnet migration is deferred until official protocol support exists.
- `docs/runbook.md` provides clean-start, smoke-test, dry-run, execute, maintenance, backup, and recovery procedures.

## Sources

- Sui DeepBook Predict docs: https://docs.sui.io/onchain-finance/deepbook-predict/
- Sui DeepBook Predict contract information: https://docs.sui.io/onchain-finance/deepbook-predict/contract-information
- DeepBook Predict announcement: https://blog.sui.io/introducing-deepbook-predict/
- Polymarket API reference: https://docs.polymarket.com/api-reference
- Polymarket authentication: https://docs.polymarket.com/api-reference/authentication
- Polymarket builder API keys: https://docs.polymarket.com/builders/api-keys
- Polygon Amoy faucet docs: https://docs.polygon.technology/tools/gas/matic-faucet
- Polygon Amoy RPC docs: https://docs.polygon.technology/pos/reference/rpc-endpoints
