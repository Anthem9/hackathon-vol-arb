# Security Notes

Keep all real credentials out of Git.

Never commit:

- Wallet private keys, mnemonics, passphrases, or keystores
- Exchange API keys or tokens
- `.env.local`
- `auth.json`
- Local databases containing credentials

Use `.env.example` for placeholders only.

Run the local secret scanner before pushing changes:

```bash
npm run secret:scan
```

The scanner checks tracked and untracked source files for high-risk key, mnemonic, token, and tokenized RPC URL assignments while ignoring local `.env*` files. It is a guardrail, not a replacement for review.

GitHub Actions runs the same scanner before typecheck, tests, lint, and build.

## Runtime Boundary

- DeepBook Predict execution is Sui Testnet only while the protocol is testnet-only.
- Polymarket CLOB calls are read-only by default; live order and cancel endpoints require explicit live flags, manual confirmation text, credentials, and notional limits.
- DeepBook Predict calls read public testnet objects only.
- The generated Sui wallet private key may exist in local `.env` for testnet smoke execution.
- The generated-wallet executor is developer tooling and must not be exposed as a normal public product action.
- Product wallet execution must be wallet-confirmed by the connected wallet.
- Polymarket authenticated trading and all mainnet execution remain disabled by default.
- Docker builds exclude `.env` and `.env.*`; container secrets are injected at runtime through compose `env_file` or deployment secret storage.

## Version 3 Foundation

- Postgres stores snapshots and alerts, not wallet private keys.
- `DATABASE_URL` belongs in local `.env` or deployment secret storage.
- Postgres backups are written under ignored `backups/` by default and must not be committed.
- The Sui wallet UI uses wallet confirmation for testnet transactions.
- The Sui wallet UI enforces configurable public risk limits: `NEXT_PUBLIC_MAX_DEPOSIT_DUSDC`, `NEXT_PUBLIC_MAX_MINT_DUSDC`, and `NEXT_PUBLIC_MAX_OPEN_EXPOSURE_DUSDC`.
- DeepBook Predict transaction execution is limited to testnet package/object IDs.
- Polymarket execution is gated off by default; mainnet DeepBook Predict execution remains disabled.

## Database Backup And Restore

Use local backups before schema changes or long-running testnet sessions:

```bash
npm run db:backup
CONFIRM_RESTORE=volarb npm run db:restore -- backups/<file>.dump
```

- Requires `pg_dump` and `pg_restore` from the PostgreSQL client tools.
- Reads `DATABASE_URL` from the environment or local `.env`.
- Restore uses `--clean --if-exists` and is destructive by design.
- Restore refuses to run unless `CONFIRM_RESTORE=volarb` is set.

## Testnet Smoke Executor

The API package includes a CLI-only executor:

```bash
pnpm --filter @vol-arb/api deepbook:testnet dry-run:mint 0.01 81000 up
```

Rules:

- Dry-run commands are safe for scheduled smoke checks.
- `execute:*` commands spend testnet funds and must only be run intentionally.
- Do not surface `execute:*` through an unauthenticated public API.
- Do not log private keys, mnemonics, or provider tokens.

## Maintenance Scheduler

The API can run dry-run/status-only maintenance checks when `ENABLE_MAINTENANCE_SCHEDULER=true`.

- Maintenance may call source health checks, Postgres checks, DeepBook transaction reconcile, and configured-wallet backfill.
- Maintenance does not sign transactions and does not spend Sui Testnet funds.
- The generated-wallet executor remains separate from the scheduler.

## Polymarket Trading Gate

- Public Polymarket market data remains enabled.
- Authenticated trading requires L2 API credentials plus a local signing private key.
- `/api/polymarket/trading-readiness` reports whether credentials are present without returning secret values.
- Live order submission and cancellation require `POLYMARKET_ENABLE_LIVE_TRADING=true`, `POLYMARKET_LIVE_TRADING_APPROVED=true`, exact manual confirmation text, Polygon mainnet chain id `137`, L2 credentials, and `POLYMARKET_MAX_LIVE_ORDER_USD` risk limits.
