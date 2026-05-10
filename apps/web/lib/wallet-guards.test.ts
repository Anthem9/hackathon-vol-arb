import assert from "node:assert/strict";
import {
  extractCreatedPredictManagerId,
  decodeWalletFailureReason,
  formatWalletFailure,
  getDepositBlockReasons,
  getMintBlockReasons,
  getRedeemBlockReasons,
  getRiskLimitBlockReasons,
  getWithdrawBlockReasons,
  isFreshOracle,
  isSuiObjectId,
  suiExplorerTxUrl,
} from "./wallet-guards";

const validId = `0x${"a".repeat(64)}`;
const packageId = `0x${"b".repeat(64)}`;

assert.equal(isSuiObjectId(validId), true);
assert.equal(isSuiObjectId("0x6"), false);
assert.equal(isSuiObjectId("not-an-id"), false);

const balanceFailure = decodeWalletFailureReason("Insufficient gas balance for transaction");
assert.equal(balanceFailure.category, "balance");
assert.match(formatWalletFailure("Insufficient gas balance for transaction"), /0.05 testnet SUI/);

const ownerFailure = decodeWalletFailureReason("MoveAbort in predict_manager: not authorized owner");
assert.equal(ownerFailure.category, "ownership");

const abortFailure = decodeWalletFailureReason("MoveAbort in module predict with code 1204");
assert.equal(abortFailure.category, "move_abort");
assert.equal(abortFailure.abortCode, "1204");

assert.equal(
  isFreshOracle({
    oracleId: validId,
    oracleStatus: "healthy",
    fallbackExpiry: Date.now() + 60_000,
    hasSurfacePoint: true,
  }),
  true,
);
assert.equal(
  isFreshOracle({
    oracleId: validId,
    oracleStatus: "stale",
    fallbackExpiry: Date.now() + 60_000,
    hasSurfacePoint: true,
  }),
  false,
);
assert.equal(
  isFreshOracle({
    oracleId: validId,
    oracleStatus: "healthy",
    fallbackExpiry: Date.now() - 60_000,
    hasSurfacePoint: true,
  }),
  false,
);

assert.deepEqual(
  getDepositBlockReasons({
    accountConnected: false,
    managerId: "0x6",
    hasManager: false,
    walletHasDusdc: false,
    managerHasDusdc: false,
    managerOwnerMatches: false,
    gasReady: false,
    oracleFresh: false,
    hasExecutableTrade: false,
  }),
  [
    "wallet not connected",
    "PredictManager ID format invalid",
    "connected wallet is not PredictManager owner",
    "SUI gas below 0.05",
    "wallet DUSDC missing",
  ],
);

assert.deepEqual(
  getMintBlockReasons({
    accountConnected: true,
    managerId: validId,
    hasManager: true,
    walletHasDusdc: false,
    managerHasDusdc: false,
    managerOwnerMatches: true,
    gasReady: true,
    oracleFresh: false,
    hasExecutableTrade: false,
  }),
  ["manager DUSDC balance is zero", "oracle missing, stale, critical, or expired", "no executable trade signal"],
);

assert.deepEqual(
  getRiskLimitBlockReasons({
    depositAmountBaseUnits: 2_000_000n,
    mintQuantityBaseUnits: 750_000n,
    currentOpenExposureBaseUnits: 500_000n,
    maxDepositBaseUnits: 1_000_000n,
    maxMintBaseUnits: 500_000n,
    maxOpenExposureBaseUnits: 1_000_000n,
  }),
  [
    "deposit exceeds per-transaction limit 1000000 base units",
    "mint exceeds per-transaction limit 500000 base units",
    "mint would exceed open exposure limit 1000000 base units",
  ],
);

assert.deepEqual(
  getRedeemBlockReasons({
    accountConnected: false,
    managerId: "",
    activePosition: null,
  }),
  ["wallet is not connected", "PredictManager ID missing", "no persisted mint position"],
);

assert.deepEqual(
  getRedeemBlockReasons({
    accountConnected: true,
    managerId: validId,
    activePosition: {
      redeemReady: false,
      redeemBlockedReason: "position has not expired",
      oracleId: null,
      expiry: null,
      strike: null,
      quantity: null,
    },
  }),
  [
    "position has not expired",
    "position oracle missing",
    "position expiry missing",
    "position strike missing",
    "position quantity missing",
  ],
);

assert.deepEqual(
  getRedeemBlockReasons({
    accountConnected: true,
    managerId: validId,
    activePosition: {
      redeemReady: true,
      oracleId: validId,
      expiry: Date.now() - 1,
      strike: "81000000000",
      quantity: "10000",
    },
  }),
  [],
);

assert.deepEqual(
  getWithdrawBlockReasons({
    accountConnected: false,
    hasManager: false,
    managerOwnerMatches: false,
    gasReady: false,
    canWithdrawQuote: false,
    managerHasDusdc: false,
  }),
  [
    "wallet is not connected",
    "PredictManager is not verified",
    "connected wallet is not PredictManager owner",
    "SUI gas balance is below safety buffer",
    "manager DUSDC balance is zero",
  ],
);

assert.deepEqual(
  getWithdrawBlockReasons({
    accountConnected: true,
    hasManager: true,
    managerOwnerMatches: true,
    gasReady: true,
    canWithdrawQuote: true,
    managerHasDusdc: true,
  }),
  [],
);

assert.equal(
  suiExplorerTxUrl("abc/123"),
  "https://suivision.xyz/txblock/abc%2F123?network=testnet",
);

assert.equal(
  extractCreatedPredictManagerId(
    {
      Transaction: {
        effects: {
          changedObjects: [
            { objectId: `0x${"c".repeat(64)}`, idOperation: "Created" },
            { objectId: validId, idOperation: "Created" },
          ],
        },
        objectTypes: {
          [`0x${"c".repeat(64)}`]: "0x2::coin::Coin<0x2::sui::SUI>",
          [validId]: `${packageId}::predict_manager::PredictManager`,
        },
      },
    },
    packageId,
  ),
  validId,
);

assert.equal(
  extractCreatedPredictManagerId(
    {
      Transaction: {
        effects: {
          changedObjects: [{ objectId: validId, idOperation: "Created" }],
        },
        objectTypes: {
          [validId]: `0x${"d".repeat(64)}::predict_manager::PredictManager`,
        },
      },
    },
    packageId,
  ),
  null,
);

console.log("wallet-guards tests passed");
