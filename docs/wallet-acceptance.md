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

- UI gate fix: mint dry-run is allowed when wallet, manager ownership, manager DUSDC, gas, oracle, and risk limits are ready, even if execution remains blocked by missing strategy signal. `Execute mint` remains disabled until an executable trade signal exists.
- Slush mint dry-run passed for manager `0x3df873e6d9330932513d83d3b44fca5fc2d1c3d5a496f93b4adaab89af51411f`, quantity `0.1`, direction `up`, oracle `0xd7a2...83ed`, and strike `81,000`.
- Wallet panel displayed: `Mint dry-run passed. Execution remains blocked until an executable trade signal is available.`
- No wallet signing prompt appeared and no mint digest was created, as expected while `Execute mint` is still disabled.

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

## Final Acceptance

The connected-wallet path is accepted only when:

- Manager ownership is verified for the connected wallet.
- Deposit, mint, redeem, and withdraw each pass dry-run before signing.
- Every signed transaction has a digest, local record, and reconciled lifecycle state.
- UI blockers prevent unsafe actions: wrong owner, insufficient gas, missing DUSDC, stale oracle, non-redeemable position, and open exposure before withdraw.
- No private keys or secrets are copied, displayed, committed, or uploaded.
