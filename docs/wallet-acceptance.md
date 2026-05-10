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

## Final Acceptance

The connected-wallet path is accepted only when:

- Manager ownership is verified for the connected wallet.
- Deposit, mint, redeem, and withdraw each pass dry-run before signing.
- Every signed transaction has a digest, local record, and reconciled lifecycle state.
- UI blockers prevent unsafe actions: wrong owner, insufficient gas, missing DUSDC, stale oracle, non-redeemable position, and open exposure before withdraw.
- No private keys or secrets are copied, displayed, committed, or uploaded.
