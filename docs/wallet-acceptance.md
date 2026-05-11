# Connected Wallet Acceptance

This checklist validates the real connected-wallet Sui Testnet path. It does not cover DeepBook Predict mainnet execution, because DeepBook Predict is testnet-only.

## Preconditions

- Production-like stack is running:
  - Web: `http://localhost:3001`
  - API: `http://localhost:4000`
  - Postgres: `localhost:55434`
- Chrome can open `http://localhost:3001/#wallet`.
- A Sui wallet extension is installed and unlocked.
- Wallet network is Sui Testnet.
- The wallet has enough testnet SUI for gas. Keep at least `0.05 SUI`.
- The wallet has DUSDC if the test should cover deposit and mint.
- Never paste or commit wallet private keys, mnemonics, API secrets, or recovery files.

Optional monitor while signing manually:

```bash
pnpm --filter @vol-arb/api deepbook:wallet-monitor \
  --owner 0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd \
  --manager 0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f \
  --watch \
  --interval 10
```

This command is read-only. It does not sign or submit transactions; it records manager readiness, balances, positions, redeemability, and withdraw blockers while the wallet flow is completed in Chrome/Slush.

## Stop Conditions

Stop the test and do not sign if any of these appear:

- The wallet is not on Sui Testnet.
- The transaction targets an unexpected package, module, or function.
- The manager owner does not match the connected wallet.
- The app displays a stale oracle, critical source, insufficient gas, missing DUSDC, open exposure, or non-redeemable position blocker.
- The wallet prompt asks for a permission or transaction that is not the current checklist step.
- Any real mainnet network appears in the wallet prompt.

## Step 1: Connect Wallet

Action:

1. Open `http://localhost:3001/#wallet`.
2. Click `Connect Wallet`.
3. Approve site connection in the wallet extension.

Expected:

- The app shows the connected account address.
- Network is `testnet`.
- The lifecycle card moves past `Connect`.
- If a PredictManager already exists, it is discovered and bound.
- If no PredictManager exists, the next safe action is manager creation.

Evidence to capture:

- Connected wallet address.
- Whether a wallet-manager binding was found or created.
- Any blocker text shown by the Wallet panel.

Previous run evidence, 2026-05-10:

- MoneyPrinter connected successfully on Sui Testnet.
- The wallet panel shows connected account `0xfdf4...44cc`.
- The wallet panel shows `SUI balance: 0.000` and `DUSDC wallet: 0`.
- The wallet panel still displays the generated-wallet manager `0xa084...87af`, so execution is blocked by owner mismatch until the connected wallet creates or loads its own PredictManager.
- Stop before signing: the connected wallet needs at least `0.05 SUI` for gas before manager creation can be executed.

Current run evidence, 2026-05-10:

- Slush connected successfully on Sui Testnet in the normal Chrome profile.
- The wallet panel shows connected account `0xd123...1dcd`.
- The wallet was funded with 20 DUSDC from the generated testnet address.
- The wallet panel loaded the owner-matched PredictManager `0x3df8...411f`.
- After the first deposit, the wallet panel shows `DUSDC wallet: 19` and `Manager balance 1 DUSDC`.

## Step 2: Create Manager

Only run if the connected wallet has no PredictManager.

Action:

1. Click the manager creation action.
2. Inspect the wallet prompt.
3. Confirm only if the target is the DeepBook Predict Testnet package and the action creates a PredictManager.

Expected:

- A manager object ID is extracted from the transaction result.
- The app binds the manager to the connected wallet.
- The manager owner matches the connected wallet.

Evidence to capture:

- Transaction digest.
- Manager object ID.
- API status from `/api/deepbook/status?owner=<wallet>`.

Current run evidence, 2026-05-10:

- Slush signing prompt was confirmed on `network=testnet`.
- Transaction target was `0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict::create_manager`.
- Created manager: `0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f`.
- Transaction digest: `5qGMbDwV7ro3fdGafQ3VtsSZmHYewHp6vhXCacN8zqEZ`.
- `/api/deepbook/status?managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd` reports the manager owner as `0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd`, `trading_balance=0`, and `nextAction=deposit_quote`.
- `/api/deepbook/positions?managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd` reports `positions=0` and only the Slush `create_manager` transaction for this manager.

## Step 3: Deposit DUSDC

Action:

1. Enter a small deposit amount within the configured risk limit.
2. Run dry-run deposit.
3. Confirm deposit in the wallet only if dry-run passes.

Expected:

- Wallet DUSDC decreases by the deposit amount plus no DUSDC fee.
- Manager DUSDC increases.
- Transaction is recorded locally and later reconciled.

Evidence to capture:

- Deposit digest.
- Manager DUSDC balance after refresh.
- Chain transaction lifecycle status.

Current run evidence, 2026-05-10:

- Funding transfer to Slush: `20 DUSDC`, digest `B47U6y5LrSyQz7gcHbUVUhqtSndhcf8cyKQauppCiPnr`.
- Slush deposit dry-run passed for `1 DUSDC`.
- Slush wallet prompt was confirmed on `network=testnet`; target was `predict_manager::deposit`; manager was `0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f`; coin outflow was `-1 DUSDC`.
- Deposit digest: `6B6zh4mBLwxQLfv2VBLyAhPsVDouL5AeEr83U25z6g2T`.
- After refresh, wallet DUSDC is `19`, manager DUSDC is `1`, open exposure is `0`, and open positions are `0`.
- `/api/deepbook/status?managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd` reports `trading_balance=1000000` and `nextAction=ready_to_mint`.
- `/api/deepbook/transactions` records `6B6zh4mBLwxQLfv2VBLyAhPsVDouL5AeEr83U25z6g2T` as `deposit_quote`, `status=success`, `lifecycleStatus=confirmed`, `source=wallet_ui`.

## Step 4: Mint

Action:

1. Select an active BTC OracleSVI candidate.
2. Enter a mint quantity within `NEXT_PUBLIC_MAX_MINT_DUSDC`.
3. Run dry-run mint.
4. Confirm mint in the wallet only if dry-run passes.

Expected:

- The app creates a persisted mint transaction record.
- Open position or open exposure increases.
- Withdraw is blocked while the position or exposure is open.

Evidence to capture:

- Mint digest.
- Oracle ID, expiry, strike, direction, quantity.
- Wallet panel blocker showing withdraw is blocked.

Current run evidence, 2026-05-10:

- UI gate fix: mint dry-run is allowed when wallet, manager ownership, manager DUSDC, gas, oracle, and risk limits are ready, even if execution remains blocked by missing strategy signal.
- Slush mint dry-run passed for manager `0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f`, quantity `0.1`, direction `up`, oracle `0xd7a2...83ed`, and strike `81,000`.
- Wallet panel displayed: `Mint dry-run passed. Execution remains blocked until an executable trade signal is available.`
- No wallet signing prompt appeared and no mint digest was created, as expected while `Execute mint` is still disabled.
- Mint dry-run evidence is persisted by `GET /api/deepbook/mint-dry-runs?owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd&managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&limit=5`; latest record has `status=success`, `quantity=100000`, `strike=81000000000000`, and dry-run digest `2Gp7RkhMyKg5KifBPPmUbpywf6td983wQn1HxW2SEdDy`.

Current run evidence, 2026-05-11:

- `production-like` enables the explicit testnet acceptance override with `NEXT_PUBLIC_ALLOW_TESTNET_WATCH_MINT=true`; this keeps real wallet signing, real Sui Testnet, and real DeepBook Predict transactions, but lets the acceptance run submit a watch-only signal.
- Wallet mint construction now uses the same `oracleId + expiry` pair and asks the API for active OracleSVI candidates. The wallet path dry-runs candidates in order and signs only the first candidate accepted by DeepBook Predict.
- The API now returns 8 active OracleSVI candidates from `/api/deepbook/status`; local dry-run evidence showed early candidates can fail with `pricing_config::quote_spread_from_fair_price` abort `1` or `predict::assert_mintable_ask` abort `7`, while later candidates pass.
- Generated-wallet smoke execution proved the same candidate-search logic with a real Sui Testnet mint: digest `Yi6WhLkHqMEN8A2ohN9qRt8DgtZu2rXUdTGsqaFdCZh`, owner `0x2e7742...bb2305`, manager `0xa0845d...9387af`, oracle `0xfe57fb...dc24b`, expiry `2026-05-11 01:30:00 Asia/Shanghai`, strike `81000000000000`, quantity `100000`.
- `/api/deepbook/positions?owner=0x2e7742f3f4edd234307f545ce772c666d2ebdfc24e64083d2375888e02bb2305&managerId=0xa0845da0646708f196fdb68ded467b8b345daaa0dc7d006bbc393a16769387af` reports `openPositions=1`, `open_exposure=98492`, `trading_balance=899664`, `redeemable_value=0`, and `canWithdrawQuote=false`.
- Slush signed mint is still pending only because local macOS UI automation cannot currently attach to Chrome (`cgWindowNotFound`). Resume by opening `http://localhost:3001/#wallet`, confirming Slush account `0xd123...1dcd`, clicking `Dry-run mint`, then `Execute mint` if the wallet prompt is Sui Testnet and targets the DeepBook Predict package.

Latest generated-wallet execution, 2026-05-11:

- After the prior generated-wallet withdraw, a direct mint attempt failed because the manager had no DUSDC balance; this was the expected `balance_manager::withdraw_with_proof` abort for insufficient manager balance and did not create a position.
- Re-deposited `1 DUSDC` into generated-wallet manager `0xa0845d...9387af`; digest `gzGQ5J1nrTWQfYbUUVzbVEhr9BfFEfiPjH24HVVaR6b`.
- Executed a real Sui Testnet mint for `0.1 DUSDC`, direction `up`, strike `81000000000000`; digest `B7WTzjDN83r85LSJ2YQztpTgy9khjTWtmiGFx9jw2v3M`, oracle `0x84eddaf7a86112c8c14e4ca34fac3a22477a3b0feaf8f3b954570fb5a0c8df15`, expiry `2026-05-11 05:45:00 Asia/Shanghai`.
- Monitor snapshot after mint reports `openPositions=1`, `open_exposure=1057`, `trading_balance=998943`, `account_value=1000170`, `redeemable_value=0`, `canWithdrawQuote=false`, and blocker `Position has not reached expiry.`
- After expiry, redeem dry-run and real redeem both succeeded with digest `7RDdWGzYWsmQpNQKKGzDzicnWnaxrpGyrchJL3RUqE3x`.
- With `openPositions=0`, `open_exposure=0`, and `canWithdrawQuote=true`, withdraw dry-run and real withdraw of `0.998943 DUSDC` both succeeded with digest `8PQTQ3ThSdkJxtTmVUkiAAudHrezAkQ1arf6WzgEtQkz`.
- Final monitor snapshot reports `trading_balance=0`, `open_exposure=0`, `open_positions=0`, `redeemable_value=0`, `account_value=0`, and position `B7WTzjDN83r85LSJ2YQztpTgy9khjTWtmiGFx9jw2v3M` marked `redeemed`.

## Step 5: Redeem

Only run after the position is expired and protocol state exposes redeemable value.

Action:

1. Refresh status.
2. Confirm the position is redeemable.
3. Run dry-run redeem.
4. Confirm redeem in the wallet only if dry-run passes.

Expected:

- Redeem transaction is recorded and reconciled.
- Redeemable value decreases.
- Position lifecycle moves out of open/redeemable state.

Evidence to capture:

- Redeem digest.
- Position lifecycle after refresh.
- Manager summary after reconcile.

Current run evidence, 2026-05-11:

- Generated-wallet position `Yi6WhLkHqMEN8A2ohN9qRt8DgtZu2rXUdTGsqaFdCZh` became redeemable at `2026-05-11 01:30:39 Asia/Shanghai`; `/api/deepbook/positions` reported `redeemableValue=100000` and `redeemReady=true`.
- Redeem dry-run passed for owner `0x2e7742...bb2305`, manager `0xa0845d...9387af`, oracle `0xfe57fb...dc24b`, expiry `1778434200000`, strike `81000000000000`, quantity `100000`.
- Real Sui Testnet redeem executed successfully with digest `5YUsHuYMUjua4r5wV6NEhSVe6PL5EmRvVEEHr8JL3NXs`.
- After refresh, manager summary reported `open_positions=0`, `open_exposure=0`, `redeemable_value=0`, and `trading_balance=999664`.
- Lifecycle reconciliation now marks chain-backfilled redeem events as `redeemed` by matching `oracleId + expiry + strike + direction + quantity`, not only by local `mintDigest` payload.

## Step 6: Withdraw

Only run after `openPositions=0`, `openExposure=0`, and `canWithdrawQuote=true`.

Action:

1. Enter a small withdraw amount.
2. Run dry-run withdraw.
3. Confirm withdraw in the wallet only if dry-run passes.

Expected:

- Manager DUSDC decreases.
- Wallet DUSDC increases.
- Withdraw transaction is recorded and reconciled.

Evidence to capture:

- Withdraw digest.
- Manager DUSDC balance after refresh.
- `/api/deepbook/positions` lifecycle summary.

Current run evidence, 2026-05-10:

- Preconditions held: `openExposure=0`, `openPositions=0`, and manager had `1 DUSDC`.
- Slush withdraw dry-run passed for `0.1 DUSDC`.
- Slush wallet prompt was confirmed on `network=testnet`; target was `predict_manager::withdraw`; manager was `0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f`; expected coin inflow was `+0.1 DUSDC`.
- Withdraw digest: `9Fz2ptgxk4Ne2To6Jn2UgjLLp462De2BLrN9LMoWJm1R`.
- After refresh, wallet DUSDC is `19.1`, manager DUSDC is `0.9`, open exposure is `0`, and open positions are `0`.
- `/api/deepbook/status?managerId=0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f&owner=0xd123dbbb133f8f43abca110200ef72d2a81d7cbc88e69e11624e9ad62b851dcd` reports `trading_balance=900000` and `nextAction=ready_to_mint`.
- `/api/deepbook/transactions` records `9Fz2ptgxk4Ne2To6Jn2UgjLLp462De2BLrN9LMoWJm1R` as `withdraw_quote`, `status=success`, `lifecycleStatus=confirmed`, `source=wallet_ui`.

Post-restart snapshot, 2026-05-11:

- After recreating the production-like API container, `deepbook:wallet-monitor` still reports Slush owner `0xd123...1dcd` bound to manager `0x3df873...411f`.
- Manager state remains ready for mint: `managerBalance=900000`, `openPositions=0`, `open_exposure=0`, `redeemable_value=0`, `canWithdrawQuote=true`, `oracleCandidates=8`, and `nextAction=ready_to_mint`.

Current run evidence, 2026-05-11:

- Preconditions held after generated-wallet redeem: `openPositions=0`, `openExposure=0`, and `canWithdrawQuote=true`.
- Withdraw dry-run passed for `0.999664 DUSDC`.
- Real Sui Testnet withdraw executed successfully with digest `GdfYVCj2quGYUyLdRBsNuSGzQGRJ7rSpSAYB6cTLxcfN`.
- Transaction balance changes include `+999664` base units DUSDC to `0x2e7742...bb2305`.
- Final `/api/deepbook/positions` state reports `trading_balance=0`, `open_exposure=0`, `open_positions=0`, `redeemable_value=0`, `canWithdrawQuote=false`, and the generated-wallet positions as `redeemed`.

## Final Acceptance

The connected-wallet path is accepted only when:

- Manager ownership is verified for the connected wallet.
- Deposit, mint, redeem, and withdraw each pass dry-run before signing.
- Every signed transaction has a digest, local record, and reconciled lifecycle state.
- UI blockers prevent unsafe actions: wrong owner, insufficient gas, missing DUSDC, stale oracle, non-redeemable position, and open exposure before withdraw.
- No private keys or secrets are copied, displayed, committed, or uploaded.
