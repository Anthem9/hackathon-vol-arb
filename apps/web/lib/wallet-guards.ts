import type { HealthStatus } from "@vol-arb/core";

export type WalletGuardInput = {
  accountConnected: boolean;
  managerId: string;
  hasManager: boolean;
  walletHasDusdc: boolean;
  managerHasDusdc: boolean;
  managerOwnerMatches: boolean;
  gasReady: boolean;
  oracleFresh: boolean;
  hasExecutableTrade: boolean;
};

export type WalletRiskLimitInput = {
  depositAmountBaseUnits?: bigint;
  mintQuantityBaseUnits?: bigint;
  currentOpenExposureBaseUnits: bigint;
  maxDepositBaseUnits: bigint;
  maxMintBaseUnits: bigint;
  maxOpenExposureBaseUnits: bigint;
};

export type WalletRedeemGuardInput = {
  accountConnected: boolean;
  managerId: string;
  activePosition?: {
    redeemReady?: boolean;
    redeemBlockedReason?: string | null;
    oracleId?: string | null;
    expiry?: number | null;
    strike?: string | null;
    quantity?: string | null;
  } | null;
};

export type WalletWithdrawGuardInput = {
  accountConnected: boolean;
  hasManager: boolean;
  managerOwnerMatches: boolean;
  gasReady: boolean;
  canWithdrawQuote: boolean;
  managerHasDusdc: boolean;
};

export type WalletFailureReason = {
  category: "balance" | "ownership" | "settlement" | "market" | "network" | "move_abort" | "unknown";
  message: string;
  advice: string;
  raw: string;
  abortCode?: string;
};

export function isSuiObjectId(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value.trim());
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function typeLooksLikePredictManager(typeName: string, packageId: string) {
  const normalized = typeName.toLowerCase();
  return typeName.startsWith(`${packageId}::`) && normalized.includes("manager");
}

export function extractCreatedPredictManagerId(transactionResult: unknown, packageId: string) {
  const root = asRecord(transactionResult);
  const transaction = asRecord(root?.Transaction) ?? root;
  const effects = asRecord(transaction?.effects);
  const changedObjects = Array.isArray(effects?.changedObjects) ? effects.changedObjects : [];
  const objectTypes = asRecord(transaction?.objectTypes) ?? {};

  for (const object of changedObjects) {
    const changed = asRecord(object);
    const objectId = typeof changed?.objectId === "string" ? changed.objectId : "";
    const objectType = typeof objectTypes[objectId] === "string" ? objectTypes[objectId] : "";
    if (changed?.idOperation === "Created" && isSuiObjectId(objectId) && typeLooksLikePredictManager(objectType, packageId)) {
      return objectId;
    }
  }

  return null;
}

export function decodeWalletFailureReason(raw: unknown): WalletFailureReason {
  const error = raw instanceof Error ? raw.message : raw;
  const message = asString(error, "Transaction failed.");
  const normalized = message.toLowerCase();
  const abortMatch = message.match(/moveabort\D*(\d+)/i) ?? message.match(/abort(?:ed)?(?: with code)?\D*(\d+)/i);
  const abortCode = abortMatch?.[1];

  if (normalized.includes("insufficient") || normalized.includes("balance") || normalized.includes("coin") || normalized.includes("no valid gas coins")) {
    return {
      category: "balance",
      message: "Balance or gas is insufficient for this DeepBook Predict transaction.",
      advice: "Refresh balances, confirm DUSDC is in the connected wallet or manager, and keep at least 0.05 testnet SUI for gas.",
      raw: message,
      abortCode,
    };
  }
  if (normalized.includes("owner") || normalized.includes("permission") || normalized.includes("not authorized")) {
    return {
      category: "ownership",
      message: "The connected wallet is not authorized to operate this PredictManager.",
      advice: "Load or create the PredictManager owned by the connected wallet before submitting this action.",
      raw: message,
      abortCode,
    };
  }
  if (normalized.includes("expiry") || normalized.includes("expired") || normalized.includes("settlement") || normalized.includes("redeem")) {
    return {
      category: "settlement",
      message: "The market expiry or settlement state does not allow this action yet.",
      advice: "Refresh positions and wait until the position is redeemable before redeeming or withdrawing.",
      raw: message,
      abortCode,
    };
  }
  if (normalized.includes("oracle") || normalized.includes("svi") || normalized.includes("market_key") || normalized.includes("strike")) {
    return {
      category: "market",
      message: "The OracleSVI, strike, direction, or market key is not valid for this transaction.",
      advice: "Refresh real market data and only execute a signal that passes the current oracle and strike guards.",
      raw: message,
      abortCode,
    };
  }
  if (normalized.includes("timeout") || normalized.includes("network") || normalized.includes("rpc") || normalized.includes("429") || normalized.includes("503")) {
    return {
      category: "network",
      message: "The Sui RPC or Predict service request failed before a reliable result was available.",
      advice: "Retry status refresh, then reconcile or backfill from chain history before submitting another transaction.",
      raw: message,
      abortCode,
    };
  }
  if (abortCode) {
    return {
      category: "move_abort",
      message: `DeepBook Predict Move abort ${abortCode}.`,
      advice: "Check manager balance, market expiry, oracle freshness, and action-specific guards before retrying.",
      raw: message,
      abortCode,
    };
  }
  return {
    category: "unknown",
    message,
    advice: "Refresh state and use Reconcile or Backfill to confirm whether anything reached chain before retrying.",
    raw: message,
    abortCode,
  };
}

export function formatWalletFailure(raw: unknown) {
  const decoded = decodeWalletFailureReason(raw);
  return decoded.category === "unknown" ? decoded.message : `${decoded.message} ${decoded.advice}`;
}

export function isFreshOracle(input: {
  oracleId?: string;
  oracleStatus?: HealthStatus;
  oracleExpiry?: number;
  fallbackExpiry?: number;
  hasSurfacePoint: boolean;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const expiry = typeof input.oracleExpiry === "number" ? input.oracleExpiry : input.fallbackExpiry;
  return Boolean(
    input.oracleId &&
      input.hasSurfacePoint &&
      typeof expiry === "number" &&
      expiry > now &&
      input.oracleStatus !== "stale" &&
      input.oracleStatus !== "critical",
  );
}

export function getDepositBlockReasons(input: WalletGuardInput) {
  const reasons: string[] = [];
  if (!input.accountConnected) reasons.push("wallet not connected");
  if (!input.managerId) reasons.push("PredictManager ID missing");
  if (input.managerId && !isSuiObjectId(input.managerId)) reasons.push("PredictManager ID format invalid");
  if (!input.managerOwnerMatches) reasons.push("connected wallet is not PredictManager owner");
  if (!input.gasReady) reasons.push("SUI gas below 0.05");
  if (!input.walletHasDusdc) reasons.push("wallet DUSDC missing");
  return reasons;
}

export function getMintBlockReasons(input: WalletGuardInput) {
  const reasons = getDepositBlockReasons({ ...input, walletHasDusdc: true });
  if (!input.hasManager) reasons.push("PredictManager summary not verified");
  if (!input.managerHasDusdc) reasons.push("manager DUSDC balance is zero");
  if (!input.oracleFresh) reasons.push("oracle missing, stale, critical, or expired");
  if (!input.hasExecutableTrade) reasons.push("no executable trade signal");
  return reasons;
}

export function getRiskLimitBlockReasons(input: WalletRiskLimitInput) {
  const reasons: string[] = [];
  if (input.depositAmountBaseUnits !== undefined && input.depositAmountBaseUnits > input.maxDepositBaseUnits) {
    reasons.push(`deposit exceeds per-transaction limit ${input.maxDepositBaseUnits.toString()} base units`);
  }
  if (input.mintQuantityBaseUnits !== undefined && input.mintQuantityBaseUnits > input.maxMintBaseUnits) {
    reasons.push(`mint exceeds per-transaction limit ${input.maxMintBaseUnits.toString()} base units`);
  }
  if (
    input.mintQuantityBaseUnits !== undefined &&
    input.currentOpenExposureBaseUnits + input.mintQuantityBaseUnits > input.maxOpenExposureBaseUnits
  ) {
    reasons.push(`mint would exceed open exposure limit ${input.maxOpenExposureBaseUnits.toString()} base units`);
  }
  return reasons;
}

export function getRedeemBlockReasons(input: WalletRedeemGuardInput) {
  const reasons: string[] = [];
  if (!input.accountConnected) reasons.push("wallet is not connected");
  if (!input.managerId) reasons.push("PredictManager ID missing");
  if (!input.activePosition) {
    reasons.push("no persisted mint position");
    return reasons;
  }
  if (!input.activePosition.redeemReady) {
    reasons.push(input.activePosition.redeemBlockedReason ?? "position is not redeemable");
  }
  if (!input.activePosition.oracleId) reasons.push("position oracle missing");
  if (!input.activePosition.expiry) reasons.push("position expiry missing");
  if (!input.activePosition.strike) reasons.push("position strike missing");
  if (!input.activePosition.quantity) reasons.push("position quantity missing");
  return reasons;
}

export function getWithdrawBlockReasons(input: WalletWithdrawGuardInput) {
  const reasons: string[] = [];
  if (!input.accountConnected) reasons.push("wallet is not connected");
  if (!input.hasManager) reasons.push("PredictManager is not verified");
  if (!input.managerOwnerMatches) reasons.push("connected wallet is not PredictManager owner");
  if (!input.gasReady) reasons.push("SUI gas balance is below safety buffer");
  if (!input.managerHasDusdc) reasons.push("manager DUSDC balance is zero");
  if (input.managerHasDusdc && !input.canWithdrawQuote) reasons.push("manager still has open position or open exposure");
  return reasons;
}

export function suiExplorerTxUrl(digest: string, network = "testnet") {
  return `https://suivision.xyz/txblock/${encodeURIComponent(digest)}?network=${encodeURIComponent(network)}`;
}
