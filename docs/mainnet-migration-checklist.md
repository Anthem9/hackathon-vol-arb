# DeepBook Predict Mainnet Migration Checklist

DeepBook Predict execution remains Sui Testnet-only until Mysten publishes official mainnet support. This checklist is a gate for future migration work, not permission to enable mainnet signing now.

## Current Policy

- Do not submit DeepBook Predict mainnet transactions.
- Do not reuse testnet package IDs, object IDs, OracleSVI IDs, quote asset types, or manager IDs on mainnet.
- Do not enable wallet signing for mainnet by changing only `SUI_NETWORK`.
- Keep Polymarket live trading disabled unless it has its own separate approval, credentials, and manual confirmation controls.

## Required Official Inputs

Collect these from official Mysten/Sui documentation or direct protocol guidance before any implementation change:

- Mainnet DeepBook Predict package ID.
- Mainnet Predict registry/object IDs.
- Mainnet OracleSVI object discovery method.
- Mainnet quote asset type and currency ID.
- Mainnet manager creation, deposit, mint, redeem, and withdraw function signatures.
- Supported RPC/gRPC endpoints and any required indexer endpoints.
- Operational guidance for settlement timing, redeemability, and deprecated RPC paths.

## Configuration Gate

Before a mainnet profile can exist:

- Add an explicit read-only mainnet profile.
- Keep signing disabled by default in that profile.
- Use separate environment variables for mainnet package IDs, object IDs, quote asset, and RPC/gRPC endpoints.
- Refuse startup if any testnet ID appears in a mainnet profile.
- Refuse startup if any mainnet ID appears in the testnet profile.
- Keep `.env`, wallet keys, API keys, and RPC tokens out of Git.

## Implementation Gate

Before mainnet signing can be enabled:

- Add source-level separation between testnet and mainnet DeepBook Predict configuration.
- Add tests proving testnet and mainnet configuration cannot be mixed.
- Add UI copy showing the active network and signing mode before every transaction.
- Add a manual confirmation step that names the network, function, manager, amount, and worst-case spend.
- Add a hard kill switch that disables all mainnet signing without redeploying code.
- Run the full connected-wallet lifecycle on testnet after the refactor still passes.

## Acceptance Gate

Mainnet execution remains disabled until all of these are true:

- Official mainnet protocol inputs are recorded in docs.
- `npm run env:check` passes for the intended profile.
- `npm run typecheck`, `npm test`, `npm run lint`, `npm run build`, and `npm run secret:scan` pass.
- Browser smoke tests confirm the UI cannot silently switch networks.
- A minimum-funds dry-run path is proven against official mainnet targets.
- The operator explicitly approves the first mainnet transaction after reviewing the transaction details in the wallet.

## First Mainnet Run

If all gates pass in the future:

1. Start with a fresh wallet funded with the minimum required amount.
2. Create or load a mainnet PredictManager only after the wallet prompt shows the expected mainnet package and function.
3. Deposit the smallest practical quote amount.
4. Mint the smallest practical position only after dry-run passes.
5. Wait for settlement and redeem.
6. Withdraw idle quote asset.
7. Reconcile and document every digest before increasing limits.

## Stop Conditions

Stop immediately if:

- The wallet prompt shows an unexpected package, function, network, amount, or manager.
- Any official ID cannot be independently verified.
- Any testnet object appears in a mainnet profile or mainnet object appears in a testnet profile.
- The app displays stale oracle, RPC, DUSDC, owner, settlement, or database degradation blockers.
- Transaction recording, reconcile, or backfill fails.
