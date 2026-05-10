import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  getDeepBookPositionState,
  getDeepBookTestnetReadiness,
  recordDeepBookChainTransaction,
} from "./deepbook-transaction-service";

const CLOCK_OBJECT_ID = "0x6";
const DEFAULT_GAS_BUDGET = 30_000_000;
const DEFAULT_STRIKE = 81_000_000_000_000;

type TestnetAction = "deposit" | "mint" | "redeem" | "withdraw";

type ExecutorOptions = {
  action: TestnetAction;
  mode: "dry-run" | "execute";
  quantity?: bigint;
  strike?: bigint;
  direction?: "up" | "down";
};

type ExecutionResult = {
  action: TestnetAction;
  mode: "dry-run" | "execute";
  ok: boolean;
  digest?: string;
  status?: string;
  error?: string;
  address: string;
  managerId: string;
  oracleId?: string;
  expiry?: number;
  strike?: string;
  quantity?: string;
};

function loadLocalEnv() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(currentDir, "../../../../.env"),
    join(process.cwd(), ".env"),
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function quoteAssetType() {
  return requiredEnv("DEEPBOOK_QUOTE_ASSET_TYPE");
}

function packageId() {
  return requiredEnv("DEEPBOOK_PREDICT_PACKAGE_ID");
}

function predictObjectId() {
  return requiredEnv("DEEPBOOK_PREDICT_OBJECT_ID");
}

function rpcUrl() {
  return process.env.SUI_TESTNET_RPC_HTTPS ?? "https://fullnode.testnet.sui.io:443";
}

function parseDusdc(value: string) {
  if (!/^\d+(\.\d{0,6})?$/.test(value)) throw new Error("amount must use up to 6 DUSDC decimals");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function signer() {
  const keypair = Ed25519Keypair.fromSecretKey(requiredEnv("SUI_TESTNET_PRIVATE_KEY"));
  const address = keypair.getPublicKey().toSuiAddress();
  const configuredAddress = requiredEnv("SUI_TESTNET_ADDRESS");
  if (address !== configuredAddress) {
    throw new Error("SUI_TESTNET_PRIVATE_KEY does not match SUI_TESTNET_ADDRESS");
  }
  return { keypair, address };
}

async function client() {
  return new SuiJsonRpcClient({ url: rpcUrl(), network: "testnet" });
}

async function buildDepositTransaction(owner: string, managerId: string, quantity: bigint) {
  const sui = await client();
  const coins = await sui.getCoins({ owner, coinType: quoteAssetType(), limit: 50 });
  if (coins.data.length === 0) throw new Error("generated wallet has no DUSDC coin objects");
  const total = coins.data.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
  if (total < quantity) throw new Error(`generated wallet DUSDC is insufficient: ${total} < ${quantity}`);

  const tx = new Transaction();
  const primary = tx.object(coins.data[0].coinObjectId);
  const mergeSources = coins.data.slice(1).map((coin) => tx.object(coin.coinObjectId));
  if (mergeSources.length > 0) tx.mergeCoins(primary, mergeSources);
  const coin = total === quantity ? primary : tx.splitCoins(primary, [tx.pure.u64(quantity)])[0];
  tx.moveCall({
    target: `${packageId()}::predict_manager::deposit`,
    typeArguments: [quoteAssetType()],
    arguments: [tx.object(managerId), coin],
  });
  return tx;
}

function buildMintTransaction(managerId: string, oracleId: string, expiry: number, strike: bigint, quantity: bigint, direction: "up" | "down") {
  const tx = new Transaction();
  const marketKey = tx.moveCall({
    target: `${packageId()}::market_key::${direction}`,
    arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strike)],
  });
  tx.moveCall({
    target: `${packageId()}::predict::mint`,
    typeArguments: [quoteAssetType()],
    arguments: [tx.object(predictObjectId()), tx.object(managerId), tx.object(oracleId), marketKey, tx.pure.u64(quantity), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

function buildRedeemTransaction(managerId: string, oracleId: string, expiry: number, strike: bigint, quantity: bigint, direction: "up" | "down") {
  const tx = new Transaction();
  const marketKey = tx.moveCall({
    target: `${packageId()}::market_key::${direction}`,
    arguments: [tx.pure.id(oracleId), tx.pure.u64(expiry), tx.pure.u64(strike)],
  });
  tx.moveCall({
    target: `${packageId()}::predict::redeem`,
    typeArguments: [quoteAssetType()],
    arguments: [tx.object(predictObjectId()), tx.object(managerId), tx.object(oracleId), marketKey, tx.pure.u64(quantity), tx.object(CLOCK_OBJECT_ID)],
  });
  return tx;
}

function buildWithdrawTransaction(owner: string, managerId: string, quantity: bigint) {
  const tx = new Transaction();
  const coin = tx.moveCall({
    target: `${packageId()}::predict_manager::withdraw`,
    typeArguments: [quoteAssetType()],
    arguments: [tx.object(managerId), tx.pure.u64(quantity)],
  });
  tx.transferObjects([coin], tx.pure.address(owner));
  return tx;
}

async function runTx(tx: Transaction, options: ExecutorOptions, resultBase: Omit<ExecutionResult, "ok">) {
  const sui = await client();
  const { keypair, address } = signer();
  tx.setSender(address);
  tx.setGasBudget(DEFAULT_GAS_BUDGET);
  const bytes = await tx.build({ client: sui });
  const dryRun = await sui.dryRunTransactionBlock({ transactionBlock: bytes });
  if (dryRun.effects.status.status !== "success") {
    return {
      ...resultBase,
      ok: false,
      status: dryRun.effects.status.status,
      error: dryRun.effects.status.error ?? dryRun.executionErrorSource ?? "dry-run failed",
    };
  }
  if (options.mode === "dry-run") {
    return { ...resultBase, ok: true, status: "success", digest: dryRun.effects.transactionDigest };
  }

  const executed = await sui.signAndExecuteTransaction({
    transaction: bytes,
    signer: keypair,
    options: { showEffects: true, showBalanceChanges: true, showEvents: true },
  });
  const ok = executed.effects?.status.status === "success";
  return {
    ...resultBase,
    ok,
    digest: executed.digest,
    status: executed.effects?.status.status,
    error: executed.effects?.status.error,
  };
}

export async function runDeepBookTestnetAction(options: ExecutorOptions): Promise<ExecutionResult> {
  loadLocalEnv();
  const { address } = signer();
  const readiness = await getDeepBookTestnetReadiness();
  const managerId = readiness.managerId;
  if (!managerId) throw new Error("DEEPBOOK_PREDICT_MANAGER_ID is not configured");

  if (options.action === "deposit") {
    const quantity = options.quantity ?? parseDusdc("0.1");
    const result = await runTx(await buildDepositTransaction(address, managerId, quantity), options, {
      action: options.action,
      mode: options.mode,
      address,
      managerId,
      quantity: quantity.toString(),
    });
    if (result.ok && options.mode === "execute" && result.digest) {
      await recordDeepBookChainTransaction({
        digest: result.digest,
        action: "deposit_quote",
        status: "success",
        owner: address,
        managerId,
        quantity: quantity.toString(),
        payload: { source: "server_testnet_executor" },
      });
    }
    return result;
  }

  if (options.action === "mint") {
    if (readiness.oracleCandidates.length === 0) throw new Error("No active BTC OracleSVI candidate discovered");
    const quantity = options.quantity ?? parseDusdc("0.01");
    const strike = options.strike ?? BigInt(DEFAULT_STRIKE);
    const direction = options.direction ?? "up";
    let result: ExecutionResult | null = null;
    for (const oracle of readiness.oracleCandidates) {
      result = await runTx(buildMintTransaction(managerId, oracle.oracleId, oracle.expiry, strike, quantity, direction), options, {
        action: options.action,
        mode: options.mode,
        address,
        managerId,
        oracleId: oracle.oracleId,
        expiry: oracle.expiry,
        strike: strike.toString(),
        quantity: quantity.toString(),
      });
      if (result.ok) break;
    }
    if (!result) throw new Error("No active BTC OracleSVI candidate discovered");
    if (result.ok && options.mode === "execute" && result.digest) {
      await recordDeepBookChainTransaction({
        digest: result.digest,
        action: "mint_binary",
        status: "success",
        owner: address,
        managerId,
        oracleId: result.oracleId,
        expiry: result.expiry,
        strike: strike.toString(),
        direction,
        quantity: quantity.toString(),
        payload: { source: "server_testnet_executor", displayStrike: Number(strike / 1_000_000_000n) },
      });
    }
    return result;
  }

  if (options.action === "redeem") {
    const state = await getDeepBookPositionState();
    const position = state.positions.find((item) => item.oracleId && item.expiry && item.strike && item.quantity);
    if (!position?.oracleId || !position.expiry || !position.strike || !position.quantity) {
      throw new Error("No persisted mint position is available for redeem");
    }
    const quantity = options.quantity ?? BigInt(position.quantity);
    const direction = position.direction === "down" ? "down" : "up";
    const result = await runTx(buildRedeemTransaction(managerId, position.oracleId, position.expiry, BigInt(position.strike), quantity, direction), options, {
      action: options.action,
      mode: options.mode,
      address,
      managerId,
      oracleId: position.oracleId,
      expiry: position.expiry,
      strike: position.strike,
      quantity: quantity.toString(),
    });
    if (result.ok && options.mode === "execute" && result.digest) {
      await recordDeepBookChainTransaction({
        digest: result.digest,
        action: "redeem_binary",
        status: "success",
        owner: address,
        managerId,
        oracleId: position.oracleId,
        expiry: position.expiry,
        strike: position.strike,
        direction,
        quantity: quantity.toString(),
        payload: { source: "server_testnet_executor", mintDigest: position.digest },
      });
    }
    return result;
  }

  const quantity = options.quantity ?? parseDusdc("0.1");
  const result = await runTx(buildWithdrawTransaction(address, managerId, quantity), options, {
    action: options.action,
    mode: options.mode,
    address,
    managerId,
    quantity: quantity.toString(),
  });
  if (result.ok && options.mode === "execute" && result.digest) {
    await recordDeepBookChainTransaction({
      digest: result.digest,
      action: "withdraw_quote",
      status: "success",
      owner: address,
      managerId,
      quantity: quantity.toString(),
      payload: { source: "server_testnet_executor" },
    });
  }
  return result;
}

export function parseExecutorCliArgs(argv: string[]) {
  const [modeAction, amount, strike, direction] = argv;
  const [mode, action] = (modeAction ?? "").split(":");
  if ((mode !== "dry-run" && mode !== "execute") || !["deposit", "mint", "redeem", "withdraw"].includes(action)) {
    throw new Error(
      "Usage: tsx src/services/deepbook-testnet-executor-cli.ts <dry-run|execute>:<deposit|mint|redeem|withdraw> [amountDusdc] [strikeUsd] [up|down]",
    );
  }
  if (direction && direction !== "up" && direction !== "down") {
    throw new Error("direction must be up or down");
  }
  const parsedDirection = direction === "up" || direction === "down" ? direction : undefined;
  return {
    mode,
    action: action as TestnetAction,
    quantity: amount ? parseDusdc(amount) : undefined,
    strike: strike ? BigInt(strike) * 1_000_000_000n : undefined,
    direction: parsedDirection,
  } satisfies ExecutorOptions;
}
