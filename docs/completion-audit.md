# Completion Audit

Date: 2026-05-10

Objective: DeepBook Predict is testnet-only, so do not migrate to mainnet; complete the remaining non-mainnet stages to a real-usable standard.

## Success Criteria

1. Keep DeepBook Predict execution on Sui Testnet only until official mainnet support exists.
2. Provide a monorepo app with Web, API, shared packages, persistent database, and operational docs.
3. Support mock, hybrid, and real public-data modes without exposing a fake product path as real execution.
4. Integrate real DeepBook Predict Testnet data, Sui Testnet transaction construction, dry-run, execution recording, reconcile, and backfill.
5. Support connected-wallet Sui Testnet UX with manager discovery/binding, guarded deposit, mint, redeem, and withdraw controls.
6. Persist snapshots, alerts, wallet-manager bindings, and chain transaction lifecycle records in Postgres.
7. Provide alerts, health, maintenance, backup, restore, and production-like Docker operations.
8. Integrate Polymarket public data and authenticated readiness/account reads while keeping live trading disabled until separately approved.
9. Keep secrets out of Git and validate the repo with automated checks.
10. Provide browser-level smoke coverage for the production-like dashboard.

## Evidence

| Criterion | Current evidence | Status |
| --- | --- | --- |
| Testnet-only DeepBook boundary | README, architecture, roadmap, runbook, env checker; `SUI_NETWORK=testnet` in production-like compose | Complete |
| Monorepo and services | `apps/web`, `apps/api`, `packages/*`, `docker-compose.production-like.yml`, Postgres service | Complete |
| Data modes | `DATA_MODE=mock\|hybrid\|real`; real adapter falls back with source status | Complete |
| DeepBook real lifecycle | Verified chain records include create manager, deposit, mint, redeem, withdraw; `/api/deepbook/positions` shows reconciled transactions and `canWithdrawQuote=true` | Complete for generated-wallet testnet path |
| Connected wallet UX | Wallet panel builds wallet-signed testnet transactions, enforces owner/gas/DUSDC/dry-run/risk guards, and has unit-tested deposit/mint/redeem/withdraw blockers | Implementation complete; full extension-wallet execution still needs manual confirmation |
| Postgres persistence | `/api/health?deep=1` reports persistence healthy; schema includes snapshots, alerts, bindings, chain events | Complete |
| Operations | `docs/runbook.md`, maintenance POST endpoint, scheduler, backup/restore scripts, production-like Docker stack | Complete |
| Polymarket readiness | Public CLOB reachable; account/readiness/order-preview/cancel-preview implemented; live trading disabled and blocked without L2 credentials | Read-only complete; live trading intentionally deferred |
| Secret safety | `.dockerignore`, `.gitignore`, `scripts/secret-scan.mjs`, CI workflow, `npm run secret:scan` passes | Complete |
| Browser smoke | `/tmp/volarb-e2e/dashboard-smoke.spec.js` passes against `http://localhost:3001` | Complete for dashboard, maintenance, execution panels |
| Chrome wallet environment | Chrome can load `http://localhost:3001/#wallet`; the wallet extension entry is visible; the wallet panel shows `Connect Wallet` and no connected account | Ready for manual wallet authorization |
| Connected wallet acceptance plan | `docs/wallet-acceptance.md` defines connect, create manager, deposit, mint, redeem, withdraw steps with stop conditions and evidence | Ready for manual execution |

## Latest Verification

- `npm run typecheck -- --force`: pass
- `npm run test -- --force`: pass
- `npm run lint -- --force`: pass
- `npm run build -- --force`: pass
- `npm run secret:scan`: pass
- `git diff --check`: pass
- `docker compose -f docker-compose.production-like.yml ps`: web, api, postgres running
- `npx playwright test dashboard-smoke.spec.js --config empty.config.js --reporter=line`: 3 passed
- GitHub Actions `CI` on `main`: pass (`25631071162`)
- `GET /api/maintenance/run`: 405, POST required
- `POST /api/maintenance/run`: success

## Known Gaps

1. A fresh browser extension wallet still needs manual end-to-end execution: connect wallet, create manager, deposit, mint, wait/settle, redeem, withdraw.
2. Polymarket L2 API credentials are not configured, so authenticated open-order reads cannot be proven in the local live environment; unit tests cover the HMAC path.
3. Polymarket order submission and cancel execution are intentionally not implemented as product actions. They require separate approval, credentials, risk review, and manual confirmation controls.
4. BTC free price sources can hit public rate limits. The app degrades and alerts, but sustained production use should add a paid or higher-quota source.
5. DeepBook Predict mainnet migration is not possible until official mainnet package IDs, objects, and operational guidance exist.

## Completion Decision

Do not mark the objective complete yet. The codebase is production-like for DeepBook Predict Sui Testnet generated-wallet and guarded connected-wallet paths, and Chrome is ready at the wallet panel, but the fresh extension-wallet execution path has not been manually authorized and proven end to end in the browser.
