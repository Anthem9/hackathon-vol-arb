import {
  persistChainTransactionEvent,
  persistWalletMintDryRunEvent,
  readWalletManagerBinding,
  readRecentChainTransactionEvents,
  readRecentWalletMintDryRunEvents,
  upsertWalletManagerBinding,
  type ChainTransactionEvent,
  type WalletMintDryRunEvent,
  type WalletManagerBinding,
} from "../db/postgres";

const CLOCK_OBJECT_ID = "0x6";

type BuildTradeBody = {
  account?: string;
  managerId?: string;
  oracleId?: string;
  expiry?: number;
  strike?: number;
  quantity?: number;
  direction?: "up" | "down";
  action?: "create_manager" | "deposit_quote" | "preview_binary" | "mint_binary" | "redeem_binary" | "withdraw_quote";
};

type ManagerSummary = {
  manager_id: string;
  owner: string;
  balances: Array<{ quote_asset: string; balance: number }>;
  trading_balance: number;
  open_exposure: number;
  redeemable_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
  account_value: number;
  open_positions: number;
  awaiting_settlement_positions: number;
};

type JsonRecord = Record<string, unknown>;

type RecordedChainTransaction = ChainTransactionEvent;

const fallbackChainEvents: RecordedChainTransaction[] = [];
const fallbackManagerBindings = new Map<string, WalletManagerBinding>();
const fallbackMintDryRuns: WalletMintDryRunEvent[] = [];

type DeepBookPosition = {
  id: string;
  lifecycle: "open" | "expired" | "pending_settlement" | "redeemable" | "redeemed" | "open_unattributed";
  digest: string | null;
  managerId?: string | null;
  oracleId?: string | null;
  expiry?: number | null;
  strike?: string | null;
  displayStrike?: unknown;
  direction?: string | null;
  quantity?: string | null;
  createdAt: number;
  redeemReady: boolean;
  redeemBlockedReason: string | null;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requiredNumber(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} is required`);
  }
  return Math.trunc(value);
}

function packageId() {
  return process.env.DEEPBOOK_PREDICT_PACKAGE_ID ?? "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
}

function predictObjectId() {
  return process.env.DEEPBOOK_PREDICT_OBJECT_ID ?? "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
}

function quoteAssetType() {
  return process.env.DEEPBOOK_QUOTE_ASSET_TYPE ?? "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
}

function predictServerUrl() {
  return process.env.DEEPBOOK_PREDICT_SERVER_URL ?? "https://predict-server.testnet.mystenlabs.com";
}

function suiRpcUrl() {
  return process.env.SUI_TESTNET_RPC_HTTPS ?? "https://fullnode.testnet.sui.io:443";
}

function configuredTestnetAddress() {
  return process.env.SUI_TESTNET_ADDRESS ?? "";
}

function configuredManagerId() {
  return process.env.DEEPBOOK_PREDICT_MANAGER_ID ?? "";
}

function normalizeSuiAddress(value: unknown, name: string) {
  const address = requiredString(value, name).trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(address)) throw new Error(`${name} must be a 32-byte Sui address`);
  return address;
}

function optionalSuiAddress(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeSuiAddress(value, "owner");
}

function normalizeSuiObjectId(value: unknown, name: string) {
  const objectId = requiredString(value, name).trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(objectId)) throw new Error(`${name} must be a 32-byte Sui object ID`);
  return objectId;
}

function quoteAssetSymbol() {
  const [, moduleName, typeName] = quoteAssetType().split("::");
  return typeName ?? moduleName ?? "DUSDC";
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(suiRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`Sui RPC returned ${response.status}`);
  }
  const payload = (await response.json()) as { result?: T; error?: { message?: string } };
  if (payload.error) {
    throw new Error(payload.error.message ?? `${method} failed`);
  }
  return payload.result as T;
}

async function getCoinBalance(owner: string, coinType: string) {
  const result = await rpcCall<{ totalBalance: string; coinObjectCount?: number }>("suix_getBalance", [owner, coinType]);
  return {
    totalBalance: result.totalBalance ?? "0",
    coinObjectCount: result.coinObjectCount ?? 0,
  };
}

async function fetchTransactionBlock(digest: string) {
  return rpcCall<{
    digest: string;
    effects?: {
      status?: {
        status?: "success" | "failure";
        error?: string;
      };
    };
    timestampMs?: string;
  }>("sui_getTransactionBlock", [
    digest,
    {
      showEffects: true,
      showEvents: false,
      showInput: false,
      showObjectChanges: false,
      showBalanceChanges: false,
    },
  ]);
}

async function queryTransactionsFromAddress(owner: string, limit: number) {
  return rpcCall<{
    data?: Array<{
      digest: string;
      transaction?: {
        data?: {
          transaction?: JsonRecord;
        };
      };
      effects?: {
        status?: {
          status?: "success" | "failure";
          error?: string;
        };
      };
      objectChanges?: unknown[];
      timestampMs?: string;
    }>;
  }>("suix_queryTransactionBlocks", [
    {
      filter: { FromAddress: owner },
      options: {
        showInput: true,
        showEffects: true,
        showEvents: false,
        showObjectChanges: true,
        showBalanceChanges: false,
      },
      limit,
      descending_order: true,
    },
  ]);
}

async function fetchManagerSummary(managerId: string) {
  const response = await fetch(`${predictServerUrl()}/managers/${managerId}/summary`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Predict server returned ${response.status}`);
  }
  return (await response.json()) as ManagerSummary;
}

async function fetchActiveBtcOracleCandidates(limit = 8) {
  const response = await fetch(`${predictServerUrl()}/oracles`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Predict oracle list returned ${response.status}`);
  }
  const payload = (await response.json()) as unknown;
  const now = Date.now();
  const rows = Array.isArray(payload) ? payload.filter(isRecord) : [];
  return rows
    .filter((row) => asString(row.underlying_asset) === "BTC")
    .filter((row) => asString(row.status) === "active")
    .filter((row) => asNumber(row.expiry) > now)
    .sort((a, b) => asNumber(a.expiry) - asNumber(b.expiry))
    .slice(0, limit)
    .map((row) => ({
      oracleId: asString(row.oracle_id),
      predictId: asString(row.predict_id),
      expiry: asNumber(row.expiry),
      minStrike: asNumber(row.min_strike),
      tickSize: asNumber(row.tick_size),
      status: asString(row.status, "unknown"),
    }));
}

async function getWalletBinding(owner?: string) {
  if (!owner) return null;
  return (await readWalletManagerBinding(owner)) ?? fallbackManagerBindings.get(owner) ?? null;
}

function predictManagerType() {
  return `${packageId()}::predict_manager::PredictManager`;
}

async function discoverOwnedPredictManagers(owner: string) {
  const result = await rpcCall<{
    data?: Array<{
      data?: {
        objectId?: string;
        type?: string;
      };
    }>;
  }>("suix_getOwnedObjects", [
    owner,
    {
      filter: { StructType: predictManagerType() },
      options: { showType: true, showContent: false, showOwner: false },
    },
  ]);
  return (result.data ?? [])
    .map((row) => row.data?.objectId)
    .filter((objectId): objectId is string => Boolean(objectId && /^0x[0-9a-fA-F]{64}$/.test(objectId)))
    .map((objectId) => objectId.toLowerCase());
}

export async function getDeepBookStatus(managerId?: string, owner?: string) {
  const normalizedOwner = optionalSuiAddress(owner);
  const binding = await getWalletBinding(normalizedOwner);
  let discoveredManagerId: string | undefined;
  let discoveryError: string | null = null;
  if (!managerId && !binding?.managerId && normalizedOwner) {
    try {
      discoveredManagerId = (await discoverOwnedPredictManagers(normalizedOwner))[0];
    } catch (error) {
      discoveryError = error instanceof Error ? error.message : "Unable to discover owned PredictManager";
    }
  }
  const resolvedManagerId = managerId ?? binding?.managerId ?? discoveredManagerId ?? configuredManagerId();
  let managerSummary: ManagerSummary | null = null;
  let managerError: string | null = null;

  if (resolvedManagerId) {
    try {
      managerSummary = await fetchManagerSummary(resolvedManagerId);
      if (normalizedOwner && managerSummary.owner.toLowerCase() === normalizedOwner) {
        fallbackManagerBindings.set(normalizedOwner, {
          network: "testnet",
          owner: normalizedOwner,
          managerId: resolvedManagerId.toLowerCase(),
          source: discoveredManagerId ? "chain_discovery" : binding?.source ?? "status_refresh",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        await upsertWalletManagerBinding({
          owner: normalizedOwner,
          managerId: resolvedManagerId.toLowerCase(),
          source: discoveredManagerId ? "chain_discovery" : binding?.source ?? "status_refresh",
        });
      }
    } catch (error) {
      managerError = error instanceof Error ? error.message : "Unable to read PredictManager summary";
    }
  }

  const managerBalance = managerSummary?.balances.find((balance) => balance.quote_asset.includes(quoteAssetSymbol()))?.balance ?? 0;
  let oracleCandidates: Awaited<ReturnType<typeof fetchActiveBtcOracleCandidates>> = [];
  try {
    oracleCandidates = await fetchActiveBtcOracleCandidates();
  } catch {
    oracleCandidates = [];
  }

  return {
    network: "testnet",
    packageId: packageId(),
    predictObjectId: predictObjectId(),
    quoteAssetType: quoteAssetType(),
    quoteAssetSymbol: quoteAssetSymbol(),
    clockObjectId: CLOCK_OBJECT_ID,
    configuredManagerId: resolvedManagerId,
    walletBinding:
      binding ??
      (normalizedOwner && discoveredManagerId
        ? {
            network: "testnet",
            owner: normalizedOwner,
            managerId: discoveredManagerId,
            source: "chain_discovery",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        : null),
    managerSummary,
    managerError: managerError ?? discoveryError,
    oracleCandidates,
    readiness: {
      hasManager: Boolean(resolvedManagerId && managerSummary),
      hasQuoteBalance: managerBalance > 0,
      managerBalance,
      nextAction: !resolvedManagerId
        ? "create_manager"
        : managerError
          ? "verify_manager"
          : managerBalance > 0
            ? "ready_to_mint"
            : "deposit_quote",
    },
  };
}

export async function getDeepBookManagerBinding(owner: string) {
  const normalizedOwner = normalizeSuiAddress(owner, "owner");
  return { binding: await getWalletBinding(normalizedOwner) };
}

export async function bindDeepBookManagerToWallet(body: unknown) {
  const input = isRecord(body) ? body : {};
  const owner = normalizeSuiAddress(input.owner, "owner");
  const managerId = normalizeSuiObjectId(input.managerId, "managerId");
  const source = asString(input.source, "wallet_ui");
  const summary = await fetchManagerSummary(managerId);
  if (summary.owner.toLowerCase() !== owner) {
    throw new Error("PredictManager owner does not match wallet owner");
  }
  const fallbackBinding: WalletManagerBinding = {
    network: "testnet",
    owner,
    managerId,
    source,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  fallbackManagerBindings.set(owner, fallbackBinding);
  const binding = await upsertWalletManagerBinding({ owner, managerId, source });
  return { binding: binding ?? fallbackBinding, managerSummary: summary };
}

export async function getDeepBookTestnetReadiness() {
  const address = configuredTestnetAddress();
  const managerId = configuredManagerId();
  const blockers: string[] = [];
  const warnings: string[] = [];
  let managerSummary: ManagerSummary | null = null;
  let managerError: string | null = null;
  let suiBalance = { totalBalance: "0", coinObjectCount: 0 };
  let quoteBalance = { totalBalance: "0", coinObjectCount: 0 };
  let oracleCandidates: Awaited<ReturnType<typeof fetchActiveBtcOracleCandidates>> = [];

  if (!address) blockers.push("SUI_TESTNET_ADDRESS is not configured");
  if (!managerId) blockers.push("DEEPBOOK_PREDICT_MANAGER_ID is not configured");

  if (address) {
    try {
      [suiBalance, quoteBalance] = await Promise.all([
        getCoinBalance(address, "0x2::sui::SUI"),
        getCoinBalance(address, quoteAssetType()),
      ]);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : "Unable to read testnet balances");
    }
  }

  if (managerId) {
    try {
      managerSummary = await fetchManagerSummary(managerId);
    } catch (error) {
      managerError = error instanceof Error ? error.message : "Unable to read PredictManager summary";
      blockers.push(managerError);
    }
  }

  try {
    oracleCandidates = await fetchActiveBtcOracleCandidates();
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Unable to discover BTC OracleSVI candidates");
  }

  const managerOwnerMatches = Boolean(address && managerSummary?.owner === address);
  const managerQuoteBalance = managerSummary?.balances.find((balance) => balance.quote_asset.includes(quoteAssetSymbol()))?.balance ?? 0;
  const suiMist = BigInt(suiBalance.totalBalance);
  const walletQuoteUnits = BigInt(quoteBalance.totalBalance);
  if (address && suiMist < 50_000_000n) blockers.push("SUI gas is below the 0.05 SUI safety buffer");
  if (managerSummary && !managerOwnerMatches) blockers.push("PredictManager owner does not match SUI_TESTNET_ADDRESS");
  if (walletQuoteUnits === 0n) blockers.push("Wallet DUSDC is missing; deposit dry-run is expected to be blocked");
  if (managerSummary && managerQuoteBalance === 0) blockers.push("PredictManager DUSDC balance is zero; mint is blocked");
  if (oracleCandidates.length === 0) blockers.push("No active BTC OracleSVI candidate discovered");

  return {
    network: "testnet",
    address,
    managerId,
    packageId: packageId(),
    predictObjectId: predictObjectId(),
    quoteAssetType: quoteAssetType(),
    balances: {
      suiMist: suiBalance.totalBalance,
      sui: Number(suiBalance.totalBalance) / 1_000_000_000,
      walletQuoteBaseUnits: quoteBalance.totalBalance,
      walletQuote: Number(quoteBalance.totalBalance) / 1_000_000,
      walletQuoteCoinObjects: quoteBalance.coinObjectCount,
      managerQuoteBaseUnits: managerQuoteBalance,
      managerQuote: managerQuoteBalance / 1_000_000,
    },
    manager: {
      configured: Boolean(managerId),
      found: Boolean(managerSummary),
      owner: managerSummary?.owner ?? null,
      ownerMatchesConfiguredAddress: managerOwnerMatches,
      error: managerError,
    },
    oracleCandidates,
    readiness: {
      canDepositDryRun: Boolean(address && managerSummary && managerOwnerMatches && suiMist >= 50_000_000n && walletQuoteUnits > 0n),
      canMintDryRun: Boolean(managerSummary && managerOwnerMatches && managerQuoteBalance > 0 && oracleCandidates.length > 0),
      blockers: Array.from(new Set(blockers)),
      warnings: Array.from(new Set(warnings)),
      nextAction: walletQuoteUnits === 0n ? "wait_for_dusdc" : managerQuoteBalance === 0 ? "deposit_quote" : "dry_run_mint",
    },
  };
}

function normalizeAction(value: unknown): RecordedChainTransaction["action"] {
  const action = asString(value);
  if (["create_manager", "deposit_quote", "mint_binary", "redeem_binary", "withdraw_quote"].includes(action)) {
    return action as RecordedChainTransaction["action"];
  }
  throw new Error("Unsupported chain transaction action");
}

function normalizeStatus(value: unknown): RecordedChainTransaction["status"] {
  const status = asString(value, "success");
  if (["submitted", "success", "failed"].includes(status)) return status as RecordedChainTransaction["status"];
  throw new Error("Unsupported chain transaction status");
}

function lifecycleFromStatus(status: RecordedChainTransaction["status"]): RecordedChainTransaction["lifecycleStatus"] {
  if (status === "failed") return "failed";
  if (status === "success") return "confirmed";
  return "submitted";
}

function normalizeLifecycleStatus(value: unknown, status: RecordedChainTransaction["status"]): RecordedChainTransaction["lifecycleStatus"] {
  const lifecycleStatus = asString(value);
  if (["pending", "submitted", "confirmed", "indexed", "reconciled", "failed"].includes(lifecycleStatus)) {
    return lifecycleStatus as RecordedChainTransaction["lifecycleStatus"];
  }
  return lifecycleFromStatus(status);
}

function normalizeDirection(value: unknown) {
  const direction = asString(value, "up");
  if (direction === "up" || direction === "down") return direction;
  throw new Error("direction must be up or down");
}

export function decodeDeepBookFailureReason(raw: unknown) {
  const message = asString(raw, "Transaction failed.");
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

function txInputs(transaction: JsonRecord) {
  return Array.isArray(transaction.inputs) ? transaction.inputs.filter(isRecord) : [];
}

function txCommands(transaction: JsonRecord) {
  return Array.isArray(transaction.transactions) ? transaction.transactions.filter(isRecord) : [];
}

function inputIndex(argument: unknown) {
  if (!isRecord(argument)) return null;
  const index = argument.Input;
  return typeof index === "number" ? index : null;
}

function inputValue(inputs: JsonRecord[], argument: unknown) {
  const index = inputIndex(argument);
  if (index === null) return undefined;
  return inputs[index];
}

function inputObjectId(inputs: JsonRecord[], argument: unknown) {
  const value = inputValue(inputs, argument);
  return typeof value?.objectId === "string" ? value.objectId : undefined;
}

function inputPureValue(inputs: JsonRecord[], argument: unknown) {
  const value = inputValue(inputs, argument);
  return typeof value?.value === "string" || typeof value?.value === "number" ? String(value.value) : undefined;
}

function firstCreatedManagerId(objectChanges: unknown[]) {
  for (const change of objectChanges) {
    if (!isRecord(change)) continue;
    const objectId = asString(change.objectId);
    const objectType = asString(change.objectType).toLowerCase();
    const changeType = asString(change.type).toLowerCase();
    if (objectId && changeType === "created" && objectType.includes(`${packageId().toLowerCase()}::`) && objectType.includes("manager")) {
      return objectId;
    }
  }
  return undefined;
}

function inferBackfillEvent(input: {
  digest: string;
  owner: string;
  transaction: JsonRecord;
  objectChanges: unknown[];
  chainStatus?: "success" | "failure";
  failureReason?: string;
  timestampMs?: string;
}): RecordedChainTransaction | null {
  const inputs = txInputs(input.transaction);
  const commands = txCommands(input.transaction);
  const moveCalls = commands
    .map((command) => (isRecord(command.MoveCall) ? command.MoveCall : null))
    .filter((moveCall): moveCall is JsonRecord => Boolean(moveCall && asString(moveCall.package).toLowerCase() === packageId().toLowerCase()));
  const primary = moveCalls.find((call) => {
    const moduleName = asString(call.module);
    const functionName = asString(call.function);
    return (
      (moduleName === "predict" && ["create_manager", "mint", "redeem"].includes(functionName)) ||
      (moduleName === "predict_manager" && ["deposit", "withdraw"].includes(functionName))
    );
  });
  if (!primary) return null;

  const callArguments = Array.isArray(primary.arguments) ? primary.arguments : [];
  const status: RecordedChainTransaction["status"] = input.chainStatus === "failure" ? "failed" : "success";
  const timestamp = input.timestampMs ? Number(input.timestampMs) : Date.now();
  const base = {
    digest: input.digest,
    status,
    lifecycleStatus: status === "failed" ? "failed" : "reconciled",
    owner: input.owner,
    payload: { source: "chain_backfill" },
    failureReason: status === "failed" ? decodeDeepBookFailureReason(input.failureReason ?? "Sui transaction failed").message : undefined,
    observedAt: Date.now(),
    confirmedAt: timestamp,
    indexedAt: Date.now(),
    reconciledAt: Date.now(),
    createdAt: timestamp,
  } satisfies Omit<RecordedChainTransaction, "action">;

  const moduleName = asString(primary.module);
  const functionName = asString(primary.function);
  if (moduleName === "predict" && functionName === "create_manager") {
    return {
      ...base,
      action: "create_manager",
      managerId: firstCreatedManagerId(input.objectChanges),
    };
  }
  if (moduleName === "predict_manager" && functionName === "deposit") {
    return {
      ...base,
      action: "deposit_quote",
      managerId: inputObjectId(inputs, callArguments[0]),
    };
  }
  if (moduleName === "predict_manager" && functionName === "withdraw") {
    return {
      ...base,
      action: "withdraw_quote",
      managerId: inputObjectId(inputs, callArguments[0]),
      quantity: inputPureValue(inputs, callArguments[1]),
    };
  }
  if (moduleName === "predict" && (functionName === "mint" || functionName === "redeem")) {
    const marketKeyCall = moveCalls.find((call) => asString(call.module) === "market_key");
    const marketArgs = Array.isArray(marketKeyCall?.arguments) ? marketKeyCall.arguments : [];
    return {
      ...base,
      action: functionName === "mint" ? "mint_binary" : "redeem_binary",
      managerId: inputObjectId(inputs, callArguments[1]),
      oracleId: inputObjectId(inputs, callArguments[2]) ?? inputPureValue(inputs, marketArgs[0]),
      expiry: marketArgs[1] === undefined ? undefined : Number(inputPureValue(inputs, marketArgs[1])),
      strike: inputPureValue(inputs, marketArgs[2]),
      direction: asString(marketKeyCall?.function) || undefined,
      quantity: inputPureValue(inputs, callArguments[4]),
    };
  }
  return null;
}

export async function recordDeepBookChainTransaction(body: unknown) {
  const input = isRecord(body) ? body : {};
  const status = normalizeStatus(input.status);
  const lifecycleStatus = normalizeLifecycleStatus(input.lifecycleStatus, status);
  const now = Date.now();
  const decodedFailure = status === "failed" ? decodeDeepBookFailureReason(input.failureReason ?? input.payload) : null;
  const event: RecordedChainTransaction = {
    digest: requiredString(input.digest, "digest"),
    action: normalizeAction(input.action),
    status,
    lifecycleStatus,
    owner: asString(input.owner) || undefined,
    managerId: asString(input.managerId) || configuredManagerId() || undefined,
    oracleId: asString(input.oracleId) || undefined,
    expiry: input.expiry === undefined ? undefined : requiredNumber(input.expiry, "expiry"),
    strike: input.strike === undefined ? undefined : String(input.strike),
    direction: asString(input.direction) || undefined,
    quantity: input.quantity === undefined ? undefined : String(input.quantity),
    payload: {
      ...(isRecord(input.payload) ? input.payload : input),
      ...(decodedFailure ? { failureCategory: decodedFailure.category, failureAdvice: decodedFailure.advice, rawFailureReason: decodedFailure.raw, abortCode: decodedFailure.abortCode } : {}),
    },
    failureReason: decodedFailure?.message ?? (asString(input.failureReason) || undefined),
    observedAt: input.observedAt === undefined ? now : requiredNumber(input.observedAt, "observedAt"),
    confirmedAt:
      input.confirmedAt === undefined
        ? lifecycleStatus === "confirmed" || lifecycleStatus === "indexed" || lifecycleStatus === "reconciled"
          ? now
          : undefined
        : requiredNumber(input.confirmedAt, "confirmedAt"),
    indexedAt:
      input.indexedAt === undefined
        ? lifecycleStatus === "indexed" || lifecycleStatus === "reconciled"
          ? now
          : undefined
        : requiredNumber(input.indexedAt, "indexedAt"),
    reconciledAt:
      input.reconciledAt === undefined
        ? lifecycleStatus === "reconciled"
          ? now
          : undefined
        : requiredNumber(input.reconciledAt, "reconciledAt"),
    createdAt: now,
  };

  fallbackChainEvents.unshift(event);
  fallbackChainEvents.splice(100);
  if (event.owner && event.managerId) {
    fallbackManagerBindings.set(event.owner.toLowerCase(), {
      network: "testnet",
      owner: event.owner.toLowerCase(),
      managerId: event.managerId.toLowerCase(),
      source: `chain_event:${event.action}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await upsertWalletManagerBinding({
      owner: event.owner.toLowerCase(),
      managerId: event.managerId.toLowerCase(),
      source: `chain_event:${event.action}`,
    });
  }
  const persistence = await persistChainTransactionEvent(event);
  return { event, persistence };
}

export async function getDeepBookChainTransactions(limit = 50) {
  const persisted = await readRecentChainTransactionEvents(limit);
  const byDigest = new Map<string, RecordedChainTransaction>();
  for (const event of [...fallbackChainEvents, ...persisted]) {
    byDigest.set(event.digest, event);
  }
  return Array.from(byDigest.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function recordDeepBookMintDryRun(body: unknown) {
  const input = isRecord(body) ? body : {};
  const owner = normalizeSuiAddress(input.owner, "owner");
  const managerId = normalizeSuiObjectId(input.managerId, "managerId");
  const oracleId = normalizeSuiObjectId(input.oracleId, "oracleId");
  const status = asString(input.status, "success");
  if (status !== "success" && status !== "failed") throw new Error("status must be success or failed");
  const event: WalletMintDryRunEvent = {
    network: "testnet",
    owner,
    managerId,
    oracleId,
    expiry: requiredNumber(input.expiry, "expiry"),
    strike: String(input.strike ?? ""),
    direction: normalizeDirection(input.direction),
    quantity: String(input.quantity ?? ""),
    status,
    dryRunDigest: asString(input.dryRunDigest) || undefined,
    failureReason: asString(input.failureReason) || undefined,
    payload: isRecord(input.payload) ? input.payload : {},
    createdAt: input.createdAt === undefined ? Date.now() : requiredNumber(input.createdAt, "createdAt"),
  };
  if (!event.strike) throw new Error("strike is required");
  if (!event.quantity) throw new Error("quantity is required");
  fallbackMintDryRuns.unshift(event);
  fallbackMintDryRuns.splice(100);
  return persistWalletMintDryRunEvent(event);
}

export async function getDeepBookMintDryRuns(input: { owner?: string; managerId?: string; limit?: number } = {}) {
  const normalizedOwner = input.owner ? normalizeSuiAddress(input.owner, "owner") : undefined;
  const normalizedManager = input.managerId ? normalizeSuiObjectId(input.managerId, "managerId") : undefined;
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 25)));
  const persisted = await readRecentWalletMintDryRunEvents({ owner: normalizedOwner, managerId: normalizedManager, limit });
  const rows = [...fallbackMintDryRuns, ...persisted].filter((event) => {
    const ownerMatches = normalizedOwner ? event.owner === normalizedOwner : true;
    const managerMatches = normalizedManager ? event.managerId === normalizedManager : true;
    return ownerMatches && managerMatches;
  });
  const byKey = new Map<string, WalletMintDryRunEvent>();
  for (const event of rows) {
    const key = event.dryRunDigest
      ? `dry-run:${event.dryRunDigest}`
      : `${event.owner}:${event.managerId}:${event.oracleId}:${event.expiry}:${event.strike}:${event.direction}:${event.quantity}:${event.createdAt}`;
    byKey.set(key, event);
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export async function reconcileDeepBookChainTransaction(digest: string) {
  const existing = (await getDeepBookChainTransactions(100)).find((event) => event.digest === digest);
  if (!existing) throw new Error("Chain transaction is not recorded locally");
  const chain = await fetchTransactionBlock(digest);
  const chainStatus = chain.effects?.status?.status;
  const now = Date.now();
  const chainTimestamp = chain.timestampMs ? Number(chain.timestampMs) : now;
  const reconciled: RecordedChainTransaction = {
    ...existing,
    status: chainStatus === "failure" ? "failed" : "success",
    lifecycleStatus: chainStatus === "failure" ? "failed" : "reconciled",
    failureReason: chainStatus === "failure" ? decodeDeepBookFailureReason(chain.effects?.status?.error ?? "Sui transaction failed").message : undefined,
    confirmedAt: existing.confirmedAt ?? chainTimestamp,
    indexedAt: existing.indexedAt ?? now,
    reconciledAt: now,
    observedAt: now,
  };
  fallbackChainEvents.unshift(reconciled);
  fallbackChainEvents.splice(100);
  const persistence = await persistChainTransactionEvent(reconciled);
  return { event: reconciled, persistence };
}

export async function reconcileRecentDeepBookChainTransactions(limit = 10) {
  const transactions = (await getDeepBookChainTransactions(limit)).filter((event) => event.lifecycleStatus !== "failed" && event.lifecycleStatus !== "reconciled");
  const reconciled = [];
  const errors = [];
  for (const event of transactions) {
    try {
      reconciled.push(await reconcileDeepBookChainTransaction(event.digest));
    } catch (error) {
      errors.push({ digest: event.digest, message: error instanceof Error ? error.message : "Reconcile failed" });
    }
  }
  return { reconciled: reconciled.map((row) => row.event), errors };
}

export async function backfillDeepBookChainTransactions(owner?: string, limit = 25) {
  const normalizedOwner = owner ? normalizeSuiAddress(owner, "owner") : normalizeSuiAddress(configuredTestnetAddress(), "owner");
  const existing = new Set((await getDeepBookChainTransactions(Math.max(100, limit))).map((event) => event.digest));
  const response = await queryTransactionsFromAddress(normalizedOwner, Math.max(1, Math.min(50, limit)));
  const recovered: RecordedChainTransaction[] = [];
  const skipped: Array<{ digest: string; reason: string }> = [];
  for (const row of response.data ?? []) {
    if (existing.has(row.digest)) {
      skipped.push({ digest: row.digest, reason: "already_recorded" });
      continue;
    }
    const transaction = row.transaction?.data?.transaction;
    if (!isRecord(transaction)) {
      skipped.push({ digest: row.digest, reason: "missing_transaction_data" });
      continue;
    }
    const event = inferBackfillEvent({
      digest: row.digest,
      owner: normalizedOwner,
      transaction,
      objectChanges: row.objectChanges ?? [],
      chainStatus: row.effects?.status?.status,
      failureReason: row.effects?.status?.error,
      timestampMs: row.timestampMs,
    });
    if (!event) {
      skipped.push({ digest: row.digest, reason: "not_deepbook_predict_action" });
      continue;
    }
    fallbackChainEvents.unshift(event);
    fallbackChainEvents.splice(100);
    await persistChainTransactionEvent(event);
    recovered.push(event);
    if (event.owner && event.managerId) {
      await upsertWalletManagerBinding({
        owner: event.owner.toLowerCase(),
        managerId: event.managerId.toLowerCase(),
        source: "chain_backfill",
      });
    }
  }
  return { owner: normalizedOwner, recovered, skipped };
}

export async function getDeepBookPositionState(managerId?: string, owner?: string) {
  const [status, allTransactions] = await Promise.all([getDeepBookStatus(managerId, owner), getDeepBookChainTransactions()]);
  const now = Date.now();
  const managerSummary = status.managerSummary;
  const normalizedManagerId = managerSummary?.manager_id.toLowerCase() ?? managerId?.toLowerCase() ?? status.configuredManagerId.toLowerCase();
  const normalizedOwner = owner?.toLowerCase();
  const transactions = allTransactions.filter((event) => {
    const managerMatches = event.managerId ? event.managerId.toLowerCase() === normalizedManagerId : false;
    const ownerMatches = normalizedOwner && event.owner ? event.owner.toLowerCase() === normalizedOwner : false;
    return managerMatches || (ownerMatches && (!event.managerId || event.managerId.toLowerCase() === normalizedManagerId));
  });
  const mintEvents = transactions.filter((event) => event.action === "mint_binary" && event.status !== "failed");
  const redeemedMintDigests = new Set(
    transactions
      .filter((event) => event.action === "redeem_binary" && event.status !== "failed")
      .map((event) => (isRecord(event.payload) ? asString(event.payload.mintDigest) : ""))
      .filter(Boolean),
  );
  const positions: DeepBookPosition[] = mintEvents.map((event) => {
    const redeemed = redeemedMintDigests.has(event.digest);
    const expired = typeof event.expiry === "number" && event.expiry <= now;
    const redeemable = Boolean(managerSummary && managerSummary.redeemable_value > 0);
    const awaitingSettlement = Boolean(managerSummary && managerSummary.awaiting_settlement_positions > 0);
    const lifecycle: DeepBookPosition["lifecycle"] = redeemed
      ? "redeemed"
      : redeemable
      ? "redeemable"
      : expired
        ? awaitingSettlement
          ? "pending_settlement"
          : "expired"
        : "open";
    return {
      id: `${event.digest}:${event.oracleId ?? "oracle"}:${event.strike ?? "strike"}`,
      lifecycle,
      digest: event.digest,
      managerId: event.managerId,
      oracleId: event.oracleId,
      expiry: event.expiry,
      strike: event.strike,
      displayStrike: event.payload.displayStrike,
      direction: event.direction,
      quantity: event.quantity,
      createdAt: event.createdAt,
      redeemReady: lifecycle === "redeemable",
      redeemBlockedReason:
        lifecycle === "redeemable"
          ? null
          : lifecycle === "redeemed"
            ? "Position has already been redeemed."
            : lifecycle === "open"
            ? "Position has not reached expiry."
            : "PredictManager summary does not expose redeemable value yet.",
    };
  });

  if (positions.length === 0 && managerSummary && managerSummary.open_positions > 0) {
    positions.push({
      id: `${managerSummary.manager_id}:unattributed-open`,
      lifecycle: "open_unattributed",
      digest: null,
      managerId: managerSummary.manager_id,
      oracleId: null,
      expiry: null,
      strike: null,
      displayStrike: null,
      direction: null,
      quantity: null,
      createdAt: Date.now(),
      redeemReady: false,
      redeemBlockedReason: "Open position exists on-chain but no local mint event is persisted yet.",
    });
  }

  return {
    network: "testnet",
    managerId: normalizedManagerId,
    managerSummary,
    managerError: status.managerError,
    positions,
    transactions,
    lifecycle: {
      hasPersistedMint: mintEvents.length > 0,
      openPositions: managerSummary?.open_positions ?? 0,
      awaitingSettlementPositions: managerSummary?.awaiting_settlement_positions ?? 0,
      redeemableValue: managerSummary?.redeemable_value ?? 0,
      canWithdrawQuote: Boolean(
        managerSummary &&
          managerSummary.open_positions === 0 &&
          managerSummary.open_exposure === 0 &&
          managerSummary.trading_balance > 0,
      ),
    },
  };
}

export function buildDeepBookTradeIntent(body: unknown) {
  const input = typeof body === "object" && body !== null ? (body as BuildTradeBody) : {};
  const action = input.action ?? "create_manager";
  const pkg = packageId();

  if (action === "create_manager") {
    return {
      network: "testnet",
      safeMode: "wallet_sign_required",
      action,
      description: "Create a shared PredictManager for the connected wallet.",
      calls: [
        {
          target: `${pkg}::predict::create_manager`,
          arguments: [],
          typeArguments: [],
        },
      ],
    };
  }

  if (action === "deposit_quote") {
    const managerId = requiredString(input.managerId, "managerId");
    const quantity = requiredNumber(input.quantity, "quantity");
    return {
      network: "testnet",
      safeMode: "dry_run_first",
      action,
      description: "Deposit DUSDC quote asset into the connected wallet's PredictManager before minting.",
      calls: [
        {
          target: `${pkg}::predict_manager::deposit`,
          arguments: [managerId, "Coin<DUSDC>", quantity],
          typeArguments: [quoteAssetType()],
        },
      ],
    };
  }

  const quantity = requiredNumber(input.quantity, "quantity");
  if (action === "withdraw_quote") {
    const managerId = requiredString(input.managerId, "managerId");
    return {
      network: "testnet",
      safeMode: "dry_run_first",
      action,
      description: "Withdraw available DUSDC quote balance from the connected wallet's PredictManager.",
      calls: [
        {
          target: `${pkg}::predict_manager::withdraw`,
          arguments: [managerId, quantity],
          typeArguments: [quoteAssetType()],
          returns: "Coin<DUSDC>",
        },
      ],
    };
  }

  const oracleId = requiredString(input.oracleId, "oracleId");
  const expiry = requiredNumber(input.expiry, "expiry");
  const strike = requiredNumber(input.strike, "strike");
  const direction = input.direction ?? "up";

  const keyCall = {
    target: `${pkg}::market_key::${direction}`,
    arguments: [oracleId, expiry, strike],
    typeArguments: [],
  };

  if (action === "preview_binary") {
    return {
      network: "testnet",
      safeMode: "read_only_preview",
      action,
      description: "Preview DeepBook Predict binary mint cost and redeem payout.",
      calls: [
        {
          target: `${pkg}::predict::get_trade_amounts`,
          arguments: [predictObjectId(), oracleId, keyCall, quantity, CLOCK_OBJECT_ID],
          typeArguments: [],
        },
      ],
    };
  }

  if (action === "redeem_binary") {
    const managerId = requiredString(input.managerId, "managerId");
    return {
      network: "testnet",
      safeMode: "settlement_required",
      action,
      description: "Build a DeepBook Predict testnet redeem transaction for an expired or redeemable binary position.",
      calls: [
        {
          target: `${pkg}::market_key::${direction}`,
          arguments: [oracleId, expiry, strike],
          typeArguments: [],
          assignTo: "marketKey",
        },
        {
          target: `${pkg}::predict::redeem`,
          arguments: [predictObjectId(), managerId, oracleId, "marketKey", quantity, CLOCK_OBJECT_ID],
          typeArguments: [quoteAssetType()],
        },
      ],
    };
  }

  const managerId = requiredString(input.managerId, "managerId");
  return {
    network: "testnet",
    safeMode: "dry_run_first",
    action,
    description: "Build a DeepBook Predict testnet mint transaction. UI keeps execution behind wallet confirmation and dry-run controls.",
    calls: [
      {
        target: `${pkg}::market_key::${direction}`,
        arguments: [oracleId, expiry, strike],
        typeArguments: [],
        assignTo: "marketKey",
      },
      {
        target: `${pkg}::predict::mint`,
        arguments: [predictObjectId(), managerId, oracleId, "marketKey", quantity, CLOCK_OBJECT_ID],
        typeArguments: [quoteAssetType()],
      },
    ],
  };
}
