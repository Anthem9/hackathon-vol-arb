# Completion Audit

Date: 2026-05-11

Objective: DeepBook Predict is testnet-only, so do not migrate to mainnet; complete the remaining non-mainnet stages to a real-usable standard.

## Success Criteria

1. Keep DeepBook Predict execution on Sui Testnet only until official mainnet support exists.
2. Provide a monorepo app with Web, API, shared packages, persistent database, and operational docs.
3. Support mock, hybrid, and real public-data modes without exposing a fake product path as real execution.
4. Integrate real DeepBook Predict Testnet data, Sui Testnet transaction construction, dry-run, execution recording, reconcile, and backfill.
5. Support connected-wallet Sui Testnet UX with manager discovery/binding, guarded deposit, mint, redeem, and withdraw controls.
6. Persist snapshots, alerts, wallet-manager bindings, and chain transaction lifecycle records in Postgres.
7. Provide alerts, health, maintenance, backup, restore, and production-like Docker operations.
8. Integrate Polymarket public data, authenticated readiness/account reads, and guarded live execution controls while keeping live trading disabled until separately approved.
9. Keep secrets out of Git and validate the repo with automated checks.
10. Provide browser-level smoke coverage for the production-like dashboard.
11. Maintain an explicit product roadmap from current testnet state to full real-world usability without treating hackathon-only demo behavior as the product target.

## Prompt-To-Artifact Checklist

| Requirement from objective/thread | Artifact or command checked | Current result |
| --- | --- | --- |
| Do not migrate DeepBook Predict to mainnet while it is testnet-only | `docs/architecture.md`, `docs/runbook.md`, `docs/mainnet-migration-checklist.md`, `docker-compose.production-like.yml`, env checker, `scripts/env-check-boundary.test.mjs` | Sui execution remains testnet-only; mainnet migration is documented as deferred and boundary-tested |
| Complete the non-mainnet DeepBook Predict flow | `deepbook-testnet-executor-cli.ts`, `/api/deepbook/positions`, `/api/deepbook/transactions` | Generated-wallet deposit, mint, redeem, and withdraw are proven on real Sui Testnet |
| Prove connected wallet path where possible | `docs/wallet-acceptance.md`, Slush API state, persisted wallet mint/redeem/withdraw records | Slush manager creation, deposit, mint dry-run, signed mint, redeem, final withdraw, binding, recording, and reconciliation are proven on real Sui Testnet |
| Keep the product real, not hackathon fake-only | `docs/roadmap.md`, wallet gates, risk blockers, production-like env | Acceptance override stays on real Sui Testnet with real wallet signing, manager ownership, DUSDC, gas, risk limits, and dry-run gates |
| Use Postgres persistence | `docker compose ... ps`, `/api/health?deep=1`, schema and transaction tables | Postgres is healthy and stores chain transactions, wallet-manager bindings, alerts, snapshots, and dry-run evidence |
| Provide operations and recovery procedures | `docs/runbook.md`, maintenance endpoint, backup/restore scripts | Runbook, maintenance, backup, and restore are present and locally verified |
| Keep secrets out of Git | `.gitignore`, `.dockerignore`, `scripts/secret-scan.mjs`, CI | Local secret scan and GitHub CI secret scan pass |
| Integrate Polymarket without unsafe live trading | `/api/polymarket/trading-readiness`, `/account`, `/order-preview`, `/cancel-preview`, `/order-execute`, `/cancel-execute`, env checker | Public data, authenticated account/balance/allowance/open-order reads, preview paths, and live execution endpoints exist; live execution remains blocked unless explicit approval and manual confirmation gates pass |
| Produce final roadmap and acceptance docs | `docs/roadmap.md`, `docs/wallet-acceptance.md`, `docs/real-integration-checklist.md` | Roadmap and acceptance docs are current through the full generated-wallet lifecycle |
| Verify browser/dashboard usability | Playwright dashboard smoke, Chrome/Slush wallet run, and local production-like stack | Dashboard smoke is green; Chrome/Slush connected-wallet signing was completed for mint, redeem, and withdraw |

## Evidence

| Criterion | Current evidence | Status |
| --- | --- | --- |
| Testnet-only DeepBook boundary | README, architecture, roadmap, runbook, env checker; `SUI_NETWORK=testnet` in production-like compose | Complete |
| Monorepo and services | `apps/web`, `apps/api`, `packages/*`, `docker-compose.production-like.yml`, Postgres service | Complete |
| Data modes | `DATA_MODE=mock\|hybrid\|real`; real adapter falls back with source status | Complete |
| DeepBook real lifecycle | Verified chain records include create manager, deposit, mint, redeem, withdraw; latest full generated-wallet cycle deposited `gzGQ5J1nrTWQfYbUUVzbVEhr9BfFEfiPjH24HVVaR6b`, minted `B7WTzjDN83r85LSJ2YQztpTgy9khjTWtmiGFx9jw2v3M`, redeemed `7RDdWGzYWsmQpNQKKGzDzicnWnaxrpGyrchJL3RUqE3x`, and withdrew `8PQTQ3ThSdkJxtTmVUkiAAudHrezAkQ1arf6WzgEtQkz` | Complete for generated-wallet testnet path |
| Connected wallet UX | Wallet panel builds wallet-signed testnet transactions, enforces owner/gas/DUSDC/dry-run/risk guards, has unit-tested deposit/mint/redeem/withdraw blockers, and now dry-runs active OracleSVI candidates until one is accepted by the protocol | Manager creation, DUSDC deposit, persisted mint dry-run, signed mint, redeem, and final withdraw are proven with Slush on testnet |
| DeepBook failure handling | API and wallet UI decode balance/gas, ownership, settlement, market/oracle, network, and unknown Move abort failures into operator-readable messages with retry advice | Complete for known categories; unknown abort codes remain conservative |
| Postgres persistence | `/api/health?deep=1` reports persistence healthy; schema includes snapshots, alerts, bindings, chain events, and wallet mint dry-run evidence | Complete |
| Operations | `docs/runbook.md`, maintenance POST endpoint, scheduler, backup/restore scripts, production-like Docker stack | Complete |
| Polymarket readiness | Public CLOB reachable; account/readiness/order-preview/cancel-preview/order-execute/cancel-execute implemented; CLI helper checks wallet/private-key/L2 credential readiness and can explicitly create or derive L2 credentials without printing secrets; authenticated collateral balance, allowance, open-order reads, and order funding preflight are proven with official CLOB L2 signing; live execution is blocked by default | Authenticated reads complete; guarded live execution controls complete; live trading intentionally disabled until operator approval |
| Secret safety | `.dockerignore`, `.gitignore`, `scripts/secret-scan.mjs`, CI workflow, `npm run secret:scan` passes | Complete |
| Browser smoke | `E2E_BASE_URL=http://localhost:3001 pnpm run test:e2e --reporter=line` | Committed Playwright smoke covers dashboard load, primary anchors, no pre-gate `TRADE`, Polymarket collateral card, wallet anchor, and maintenance `NO SIGNING` |
| Chrome wallet environment | Chrome loaded `http://localhost:3001/#wallet`; Slush connected on Sui Testnet; wallet account `0xd123...1dcd` created owner-matched manager `0x3df8...411f`, deposited `1 DUSDC`, minted, redeemed, and withdrew the remaining manager DUSDC | Connected wallet lifecycle complete on Sui Testnet |
| Connected wallet acceptance plan | `docs/wallet-acceptance.md` defines connect, create manager, deposit, mint, redeem, withdraw steps with stop conditions and evidence | Accepted for the current Slush Sui Testnet path |
| Product readiness roadmap | `docs/roadmap.md` now defines connected-wallet acceptance, DeepBook testnet hardening, strategy executability, Polymarket real account integration, small-capital operation, mainnet readiness, and final UX/submission stages | Complete as planning artifact |
| Demo script | `docs/demo-script.md` | Recording path emphasizes real Sui Testnet execution, guarded Polymarket preview, no secret exposure, no fake mainnet claim, and operations evidence |
| Mainnet migration gate | `docs/mainnet-migration-checklist.md` defines official-input, configuration, implementation, acceptance, first-run, and stop-condition gates before any future mainnet signing path | Complete as safety artifact; execution remains disabled |

## Latest Verification

- `npm run typecheck`: pass
- `npm test`: pass, including `scripts/env-check-boundary.test.mjs`
- `npm run lint`: pass
- `npm run build`: pass
- `npm run secret:scan`: pass
- `git diff --check`: pass
- `docker compose -f docker-compose.production-like.yml ps`: web, api, postgres running
- `docker compose -f docker-compose.production-like.yml up -d --build web api`: pass
- `GET /api/deepbook/status?managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd`: owner matches Slush, `trading_balance=1000000`, `nextAction=ready_to_mint`
- `GET /api/deepbook/transactions`: Slush deposit `6B6zh4mBLwxQLfv2VBLyAhPsVDouL5AeEr83U25z6g2T` recorded as `deposit_quote`, `status=success`, `lifecycleStatus=confirmed`
- `GET /api/deepbook/status?managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd`: after Slush withdraw, `trading_balance=900000`, `open_exposure=0`, `open_positions=0`
- `GET /api/deepbook/transactions`: Slush withdraw `9Fz2ptgxk4Ne2To6Jn2UgjLLp462De2BLrN9LMoWJm1R` recorded as `withdraw_quote`, `status=success`, `lifecycleStatus=confirmed`
- Chrome Slush wallet panel: `Dry-run mint` enabled while `Execute mint` remains disabled; mint dry-run passed and reported `Execution remains blocked until an executable trade signal is available.`
- `GET /api/deepbook/mint-dry-runs?owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd&managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&limit=5`: one persisted Slush dry-run record, `status=success`, `quantity=100000`, `strike=81000000000000`, dry-run digest `2Gp7RkhMyKg5KifBPPmUbpywf6td983wQn1HxW2SEdDy`
- `GET /api/deepbook/positions?managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd`: 0 positions, 1 create_manager transaction
- `pnpm --filter @vol-arb/api deepbook:testnet execute:mint 0.1 81000 up`: success, digest `Yi6WhLkHqMEN8A2ohN9qRt8DgtZu2rXUdTGsqaFdCZh`, oracle `0xfe57fb1ab64888de060b1f50bd011ce054d6fb24b201ab77972f66a6fa8dc24b`, expiry `1778434200000`
- `pnpm --filter @vol-arb/api exec tsx src/services/deepbook-testnet-executor-cli.ts dry-run:redeem`: success for oracle `0xfe57fb1ab64888de060b1f50bd011ce054d6fb24b201ab77972f66a6fa8dc24b`, expiry `1778434200000`, strike `81000000000000`, quantity `100000`
- `pnpm --filter @vol-arb/api exec tsx src/services/deepbook-testnet-executor-cli.ts execute:redeem`: success, digest `5YUsHuYMUjua4r5wV6NEhSVe6PL5EmRvVEEHr8JL3NXs`
- `GET /api/deepbook/positions?owner=0x2e7742f3f4edd234307f545ce772c666d2ebdfc24e64083d2375888e02bb2305&managerId=0xa0845da0646708f196fdb68ded467b8b345daaa0dc7d006bbc393a16769387af`: after redeem, `openPositions=0`, `open_exposure=0`, `trading_balance=999664`, `redeemable_value=0`, `canWithdrawQuote=true`
- `pnpm --filter @vol-arb/api exec tsx src/services/deepbook-testnet-executor-cli.ts dry-run:withdraw 0.999664`: success
- `pnpm --filter @vol-arb/api exec tsx src/services/deepbook-testnet-executor-cli.ts execute:withdraw 0.999664`: success, digest `GdfYVCj2quGYUyLdRBsNuSGzQGRJ7rSpSAYB6cTLxcfN`
- `GET /api/deepbook/positions?owner=0x2e7742f3f4edd234307f545ce772c666d2ebdfc24e64083d2375888e02bb2305&managerId=0xa0845da0646708f196fdb68ded467b8b345daaa0dc7d006bbc393a16769387af`: after withdraw, `trading_balance=0`, `open_exposure=0`, `open_positions=0`, `redeemable_value=0`, `canWithdrawQuote=false`, positions marked `redeemed`
- `suix_getBalance` for generated-wallet DUSDC after withdraw: `totalBalance=4959999664`
- `GET /api/deepbook/status?owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd&managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f`: API returns 8 active OracleSVI candidates for wallet mint candidate-search
- Local dry-run probe for Slush manager: current early active candidates can fail with `pricing_config::quote_spread_from_fair_price` abort `1` or `predict::assert_mintable_ask` abort `7`; later active candidates pass, validating the candidate-search fix
- Slush connected-wallet mint dry-run passed for owner `0xd123...1dcd`, manager `0x3df8...411f`, oracle `0x3f3978...a531`, expiry `1778464800000`, strike `82000000000000`, direction `up`, quantity `100000`, dry-run digest `Gd84jpht6LLEBedMpjgkurHUBSTrGHFpCyBiZ5qEpaNA`
- Slush signed mint succeeded with digest `9cvdVgSJc5m1eShyhvv6ijx4hbdPbDc11e1SKsG3THZW`; after mint the manager held `0.897556 DUSDC`, `openPositions=1`, and `openExposure=2444`
- After expiry, `/api/deepbook/positions` marked the Slush position redeemable even with `redeemableValue=0`, and Slush signed redeem succeeded with digest `CA5PoCejdGGeAwwydZfARDC5BXdzAr4At86QK5xAouVc`
- Slush final withdraw of `0.897556 DUSDC` succeeded with digest `FkuuHYmaXxxp9qtZeQJya7MCxqseP8os7CweLKNPcVbz`; final API state reports `trading_balance=0`, `open_exposure=0`, `open_positions=0`, `redeemable_value=0`, `canWithdrawQuote=false`, wallet DUSDC `19.997556`, and the Slush position marked `redeemed`
- `GET /api/polymarket/trading-readiness`: public CLOB reachable, wallet address and local signing material configured, L2 API key/secret/passphrase configured, `network=polygon`, `chainId=137`, `POLYMARKET_ENABLE_LIVE_TRADING=false`, `safeMode=read_only`, authenticated requests enabled
- `GET /api/polymarket/account`: Data API account read returns configured wallet `0xea5C...DD18`, zero positions, zero orders; authenticated collateral balance/allowance and open-order reads succeed with official CLOB L2 signing.
- `POST /api/polymarket/order-preview`: returns notional/max loss/max profit, checks collateral balance/allowance, and blocks submission on disabled live trading or insufficient funding
- `POST /api/polymarket/cancel-preview`: validates order-id shape but blocks cancel because live trading is disabled and the order is not in authenticated open orders
- `POST /api/polymarket/order-execute`: implemented through official CLOB SDK and returns `submitted=false` while `POLYMARKET_ENABLE_LIVE_TRADING=false`; also enforces manual confirmation text and `POLYMARKET_MAX_LIVE_ORDER_USD`
- `POST /api/polymarket/cancel-execute`: implemented through official CLOB SDK and returns `submitted=false` while `POLYMARKET_ENABLE_LIVE_TRADING=false`; also enforces manual confirmation text and authenticated open-order matching
- `pnpm --filter @vol-arb/api polymarket:credentials`: pass; configured Polymarket wallet and local private key match, L2 credentials are configured, live trading remains disabled
- Production-like rebuild after Polymarket authenticated-read work: `docker compose -f docker-compose.production-like.yml up -d --build api` succeeded; web/API/Postgres are running; `/api/health?deep=1` is healthy; `/api/polymarket/trading-readiness` returns `network=polygon`, `chainId=137`, L2 credentials configured, live trading disabled; `/api/polymarket/account` returns `balanceAllowance.enabled=true` and `openOrders.enabled=true`
- Production-like browser smoke after restoring a committed Playwright harness: `E2E_BASE_URL=http://localhost:3001 pnpm run test:e2e --reporter=line` passed 1/1 on Chromium.
- Latest GitHub Actions `CI` on `main`: pass (`25648899312`) after committed Playwright smoke, Polymarket funding preflight, configurable BTC price source, small-capital gate runbook, real testnet demo script updates, and refreshed completion audit evidence.
- `/api/source-statuses` after the latest production-like rebuild reports `btc-price` as `healthy` with `3 source(s), divergence 0.01%.`
- Chrome automation retry on 2026-05-11: opening `http://localhost:3001/#wallet` succeeded through macOS, but Computer Use still returns `Apple event error -10005: cgWindowNotFound`
- Latest generated-wallet live test on 2026-05-11: re-deposit `1 DUSDC` digest `gzGQ5J1nrTWQfYbUUVzbVEhr9BfFEfiPjH24HVVaR6b`; mint `0.1 DUSDC` digest `B7WTzjDN83r85LSJ2YQztpTgy9khjTWtmiGFx9jw2v3M`; redeem digest `7RDdWGzYWsmQpNQKKGzDzicnWnaxrpGyrchJL3RUqE3x`; withdraw `0.998943 DUSDC` digest `8PQTQ3ThSdkJxtTmVUkiAAudHrezAkQ1arf6WzgEtQkz`; final generated-wallet state has `trading_balance=0`, `openPositions=0`, `open_exposure=0`, and all positions redeemed.
- Direct `BtcPriceAdapter.fetchSpot()` check after adding Kraken redundancy: sources `CoinGecko`, `Coinbase`, and `Kraken`, `status=healthy`, divergence `0.04%`
- `pnpm run db:backup`: pass, wrote an ignored Postgres dump under `backups/`
- `pnpm run db:restore:check -- backups/volarb-2026-05-10T20-37-16-231Z.dump`: pass, verified 68 archive entries without touching a database
- `GET /api/maintenance/run`: 405, POST required
- `POST /api/maintenance/run`: success

## External Preconditions

1. Polymarket real order submission and cancel execution are implemented but intentionally disabled by default. Before any live use, the operator must fund the account, set allowances, and complete legal/risk approval; the small-capital runbook is documented in `docs/runbook.md`.
2. BTC free price sources can hit public rate limits. The app supports an optional configured paid or higher-quota BTC price endpoint while keeping CoinGecko, Coinbase, and Kraken redundancy; an operator still needs to choose and fund a production provider for sustained use.
3. DeepBook Predict mainnet migration remains impossible until official mainnet package IDs, objects, and operational guidance exist.

## BTC 5m Strategy Research Addendum

Date: 2026-05-14

Objective: Build a real-usable BTC 5-minute Polymarket research and strategy pipeline,
including probability-cone baselines, limit-order-only backtests, strict risk controls,
genetic search, Beijing day/night and weekday/weekend segmentation, historical/live data
collection, and a hard readiness gate before any live trading.

### BTC 5m Prompt-To-Artifact Checklist

| Requirement from objective/thread | Artifact or command checked | Current result |
| --- | --- | --- |
| Use recent 7-day BTC 5m markets as the initial research window | `pnpm --filter @vol-arb/api btc5m:research collect-markets --days 7`, `coverage --days 7` | `2007` markets currently tracked |
| Use Polymarket BTC 5m market data, not only external exchange BTC prices | Gamma metadata, CLOB book snapshots, CLOB price history, Data API trades in `btc5m-research-service.ts` | Implemented; external BTC ticks are auxiliary probability-cone inputs only |
| Collect forward orderbook data for executable limit-order evidence | `collect-orderbook-live`, `collect-orderbook-sessions`, `pnpm btc5m:orderbook:*` | Background collector is running under `caffeinate`; current orderbook coverage is still sparse |
| Respect Beijing daytime/nighttime and weekday/weekend differences | `segmentMarketCoverage`, `targetSegment`, `weakestOrderbookSegments`, `nextWeakSegmentWindows` | Implemented; weakest segments are surfaced for targeted collection |
| Use only limit orders in simulation | Backtest entry/exit logic, docs, readiness checks | Implemented for entry, take-profit, stop-loss, time exit, and settlement fallback gates |
| Simulate with `100 USDC` initial capital and `10%` max single-trade loss | `DEFAULT_BACKTEST_PARAMS`, CLI usage, `docs/btc5m-research-pipeline.md` | Implemented as defaults |
| Add trader-style risk controls | Max daily loss, max drawdown, max consecutive losses, max open markets, max daily trades | Implemented and exposed in reports/search space |
| Optionally use Kelly sizing | `useKellySizing`, `kellyFraction`, GA mutation space | Implemented, clipped by hard risk limits |
| Add probability-cone baseline strategy | `probability_cone`, `longshot_cone` | Implemented |
| Add genetic algorithm strategy search | `genetic`, `genetic-sweep`, seeded runs, report saving | Implemented with train/validation, stress validation, walk-forward validation, and multi-seed sweeps |
| Prevent stale or non-executable signals | `maxSignalStalenessSeconds`, bid/ask side separation, visible liquidity participation, observed-size checks | Implemented and tested |
| Preserve experiment evidence and gate final acceptance | `--save-report` for backtest, genetic, genetic-sweep, readiness; `pnpm btc5m:checkpoint`; `pnpm btc5m:checkpoint:status`; `pnpm btc5m:checkpoint:gate`; `pnpm btc5m:checkpoint --require-live-ready` | Implemented; reports write under ignored `.local/reports`, checkpoint combines orderbook plan plus readiness in one artifact, `checkpoint:status` provides a no-GA status shortcut while waiting for data, and `checkpoint:gate` exits non-zero unless the strategy is actually ready |
| Gate live use on real evidence instead of in-sample PnL | `btc5m:research readiness --with-ga`, `acceptanceBlockers`, orderbook coverage gates | Implemented; current result is correctly not live-ready |

### BTC 5m Current Evidence

- Latest plan command: `pnpm btc5m:orderbook:plan`.
- Background collector: running, PID `38702`, launched through `caffeinate`.
- Current execution quality: `trade_proxy_only`.
- Markets with orderbook snapshots: `30/2007`.
- Current orderbook market coverage: `0.014947683109118086`.
- Global `partial_orderbook` target: `201` markets.
- Remaining markets until `partial_orderbook`: `171`.
- Estimated continuous collection time until `partial_orderbook`: `14.25` hours.
- Weakest Beijing regimes: `weekday_beijing_day` and `weekend_beijing_night`, both
  still at `0` orderbook markets.
- Current collection recommendation: keep the running untargeted collector active because
  it can enter the next weak `weekday_beijing_day` window without a restart.
- Latest readiness smoke with GA returned `liveReady=false`. The selected GA strategy
  was `longshot_cone`, and settled paper evidence passed because only the unselected
  `lottery_reprice` strategy is currently blocked. Remaining failed checks:
  `orderbook_market_coverage`, `balanced_beijing_orderbook_segments`,
  `execution_quality`, and `genetic_acceptance`.
- Latest checkpoint smoke command: `pnpm btc5m:checkpoint` with reduced GA smoke
  parameters. It wrote an ignored report under `.local/reports` and returned
  `recommendedAction=keep_current_collector_running`.
- Low-cost checkpoint command: `pnpm btc5m:checkpoint:status`, equivalent to
  `node scripts/btc5m-checkpoint.mjs --no-ga`; use it for frequent coverage checks while
  waiting for orderbook data, but keep GA enabled for final acceptance.
- Final gate command: `pnpm btc5m:checkpoint:gate`, equivalent to
  `pnpm btc5m:checkpoint --require-live-ready`; current status intentionally exits
  non-zero because `liveReady=false`.

### BTC 5m Completion Decision

Do not mark the BTC 5m strategy objective complete yet.

Engineering infrastructure is materially complete for the current research stage: data
collection, probability-cone modeling, strict limit-order backtesting, risk controls,
genetic search, report persistence, and readiness gates exist and have been smoke tested.
However, the strategy itself is not proven real-usable because execution evidence is still
`trade_proxy_only`, orderbook coverage is far below `partial_orderbook`, Beijing segment
coverage is unbalanced, and the readiness audit correctly returns `liveReady=false`.

The next required action is continued forward orderbook collection through weak Beijing
segments, using `pnpm btc5m:checkpoint:status` for cheap interim checks. Once orderbook
coverage reaches the required threshold, rerun `pnpm btc5m:checkpoint`, saved backtest,
seeded GA, multi-seed sweep, and readiness reports, then require
`pnpm btc5m:checkpoint:gate` to pass. Only a readiness/checkpoint result
with `liveReady=true` and no acceptance blockers should be treated as evidence for moving
toward controlled live operation.

## DeepBook Completion Decision

Mark the objective complete for the current codebase scope: DeepBook Predict remains testnet-only, all implementable non-mainnet stages are covered by code, docs, tests, production-like smoke evidence, and GitHub CI. The remaining items above are external operator/protocol preconditions, not missing implementation in this repository.
