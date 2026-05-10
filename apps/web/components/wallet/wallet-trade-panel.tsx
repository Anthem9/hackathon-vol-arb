"use client";

import { useEffect, useMemo, useState } from "react";
import { DAppKitProvider, useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Transaction } from "@mysten/sui/transactions";
import { CheckCircle2, ShieldAlert, WalletCards } from "lucide-react";
import type { HealthStatus, VolSurface } from "@vol-arb/core";
import {
  bindDeepBookManager,
  createDeepBookIntent,
  fetchDeepBookManagerBinding,
  fetchDeepBookPositions,
  fetchDeepBookStatus,
  recordDeepBookTransaction,
  type DeepBookPositionState,
  type DeepBookStatus,
} from "../../lib/api-client";
import { extractCreatedPredictManagerId, getDepositBlockReasons, getMintBlockReasons, getRedeemBlockReasons, getRiskLimitBlockReasons, getWithdrawBlockReasons, isFreshOracle, isSuiObjectId, suiExplorerTxUrl } from "../../lib/wallet-guards";
import { dAppKit } from "../../app/dapp-kit";

const PACKAGE_ID = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
const PREDICT_OBJECT_ID = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
const QUOTE_ASSET_TYPE = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
const CLOCK_OBJECT_ID = "0x6";
const DUSDC_DECIMALS = 6n;
const DEFAULT_DEPOSIT_DUSDC = "1";
const DEFAULT_MINT_UNITS = "0.1";
const MIN_GAS_MIST = 50_000_000n;
const STRIKE_SCALE = 1_000_000_000n;
const PENDING_CHAIN_RECORDS_KEY = "volarb:pending-deepbook-chain-records";

function envDusdcLimit(name: string, fallback: string) {
  try {
    return parseBaseUnits(process.env[name] ?? fallback);
  } catch {
    return parseBaseUnits(fallback);
  }
}

const MAX_DEPOSIT_BASE_UNITS = envDusdcLimit("NEXT_PUBLIC_MAX_DEPOSIT_DUSDC", "5");
const MAX_MINT_BASE_UNITS = envDusdcLimit("NEXT_PUBLIC_MAX_MINT_DUSDC", "1");
const MAX_OPEN_EXPOSURE_BASE_UNITS = envDusdcLimit("NEXT_PUBLIC_MAX_OPEN_EXPOSURE_DUSDC", "5");

type PendingChainRecord = {
  digest: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatBaseUnits(value: bigint | number | string, decimals = DUSDC_DECIMALS) {
  const amount = BigInt(value);
  const divisor = 10n ** decimals;
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionText = fraction.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return fractionText ? `${whole}.${fractionText}` : whole.toString();
}

function parseBaseUnits(value: string, decimals = DUSDC_DECIMALS) {
  const normalized = value.trim();
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) {
    throw new Error("Amount must be a positive DUSDC value with up to 6 decimals.");
  }
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** decimals + BigInt(fraction.padEnd(Number(decimals), "0"));
}

function tryParseBaseUnits(value: string) {
  try {
    return parseBaseUnits(value);
  } catch {
    return undefined;
  }
}

function toChainStrike(strike: number) {
  return BigInt(Math.trunc(strike)) * STRIKE_SCALE;
}

function resultDigest(result: { Transaction?: { digest?: string }; FailedTransaction?: { status?: { error?: string | { message?: string } | null } } }) {
  const failure = result.FailedTransaction;
  if (failure) {
    const error = failure.status?.error;
    throw new Error(typeof error === "string" ? error : error?.message ?? "Transaction failed.");
  }
  return result.Transaction?.digest ?? "digest pending";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPendingChainRecords() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_CHAIN_RECORDS_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((record): record is PendingChainRecord => {
          return Boolean(record && typeof record.digest === "string" && record.payload && typeof record.payload === "object");
        })
      : [];
  } catch {
    return [];
  }
}

function writePendingChainRecords(records: PendingChainRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PENDING_CHAIN_RECORDS_KEY, JSON.stringify(records.slice(0, 25)));
}

function queuePendingChainRecord(payload: Record<string, unknown>) {
  const digest = typeof payload.digest === "string" ? payload.digest : "";
  if (!digest) return 0;
  const records = readPendingChainRecords().filter((record) => record.digest !== digest);
  records.unshift({ digest, payload, createdAt: Date.now() });
  writePendingChainRecords(records);
  return records.length;
}

function removePendingChainRecord(digest: string) {
  writePendingChainRecords(readPendingChainRecords().filter((record) => record.digest !== digest));
}

function ReadinessItem({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-terminal-muted">{label}</p>
        {ready ? <CheckCircle2 className="h-4 w-4 text-terminal-green" /> : <ShieldAlert className="h-4 w-4 text-terminal-amber" />}
      </div>
      <p className="mt-2 text-sm text-slate-200">{detail}</p>
    </div>
  );
}

function LifecycleStep({
  label,
  status,
  detail,
}: {
  label: string;
  status: "done" | "active" | "blocked" | "pending";
  detail: string;
}) {
  const statusClass =
    status === "done"
      ? "border-terminal-green/40 bg-terminal-green/10 text-terminal-green"
      : status === "active"
        ? "border-terminal-cyan/50 bg-terminal-cyan/10 text-terminal-cyan"
        : status === "blocked"
          ? "border-terminal-amber/50 bg-terminal-amber/10 text-terminal-amber"
          : "border-white/10 bg-black/20 text-terminal-muted";

  return (
    <div className={`rounded-md border p-3 ${statusClass}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em]">{label}</p>
        <span className="h-2 w-2 rounded-full bg-current" />
      </div>
      <p className="mt-2 text-sm text-slate-200">{detail}</p>
    </div>
  );
}

type WalletTradePanelProps = {
  surfaces: VolSurface[];
  oracleId?: string;
  oracleStatus?: HealthStatus;
  oracleLagSeconds?: number;
  oracleExpiry?: number;
  hasExecutableTrade?: boolean;
};

function WalletTradeContent({
  surfaces,
  oracleId,
  oracleStatus,
  oracleLagSeconds,
  oracleExpiry,
  hasExecutableTrade = false,
}: WalletTradePanelProps) {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const kit = useDAppKit();
  const [balance, setBalance] = useState<string>("--");
  const [suiMistBalance, setSuiMistBalance] = useState<bigint>(0n);
  const [dusdcBalance, setDusdcBalance] = useState<bigint>(0n);
  const [dusdcCoinCount, setDusdcCoinCount] = useState(0);
  const [deepBookStatus, setDeepBookStatus] = useState<DeepBookStatus | null>(null);
  const [managerId, setManagerId] = useState("");
  const [depositAmount, setDepositAmount] = useState(DEFAULT_DEPOSIT_DUSDC);
  const [mintQuantity, setMintQuantity] = useState(DEFAULT_MINT_UNITS);
  const [withdrawAmount, setWithdrawAmount] = useState(DEFAULT_MINT_UNITS);
  const [intentText, setIntentText] = useState("No transaction intent built.");
  const [txStatus, setTxStatus] = useState("Connect Sui Wallet on testnet to build a transaction.");
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [positionState, setPositionState] = useState<DeepBookPositionState | null>(null);
  const [bindingStatus, setBindingStatus] = useState("No wallet manager binding loaded.");
  const [recoveryStatus, setRecoveryStatus] = useState("");

  const selected = useMemo(() => {
    const surface = surfaces[0];
    const point = surface?.points[Math.floor((surface.points.length - 1) / 2)];
    return { surface, point };
  }, [surfaces]);

  const selectedStrike = selected.point?.strike ?? 0;
  const managerQuoteBalance = BigInt(deepBookStatus?.readiness.managerBalance ?? 0);
  const depositAmountBaseUnits = tryParseBaseUnits(depositAmount);
  const mintQuantityBaseUnits = tryParseBaseUnits(mintQuantity);
  const currentOpenExposureBaseUnits = BigInt(deepBookStatus?.managerSummary?.open_exposure ?? 0);
  const managerIdValid = !managerId || isSuiObjectId(managerId);
  const hasManager = Boolean(managerIdValid && managerId && deepBookStatus?.managerSummary);
  const managerOwnerMatches = Boolean(account && deepBookStatus?.managerSummary?.owner === account.address);
  const walletHasDusdc = dusdcBalance > 0n;
  const managerHasDusdc = managerQuoteBalance > 0n;
  const gasReady = suiMistBalance >= MIN_GAS_MIST;
  const oracleFresh = isFreshOracle({
    oracleId,
    oracleStatus,
    oracleExpiry,
    fallbackExpiry: selected.surface?.expiry,
    hasSurfacePoint: Boolean(selected.surface && selected.point),
  });
  const guardInput = {
    accountConnected: Boolean(account),
    managerId,
    hasManager,
    walletHasDusdc,
    managerHasDusdc,
    managerOwnerMatches,
    gasReady,
    oracleFresh,
    hasExecutableTrade,
  };
  const riskLimitBlockReasons = getRiskLimitBlockReasons({
    depositAmountBaseUnits,
    mintQuantityBaseUnits,
    currentOpenExposureBaseUnits,
    maxDepositBaseUnits: MAX_DEPOSIT_BASE_UNITS,
    maxMintBaseUnits: MAX_MINT_BASE_UNITS,
    maxOpenExposureBaseUnits: MAX_OPEN_EXPOSURE_BASE_UNITS,
  });
  const depositRiskBlockReasons = riskLimitBlockReasons.filter((reason) => reason.startsWith("deposit"));
  const mintRiskBlockReasons = riskLimitBlockReasons.filter((reason) => reason.startsWith("mint"));
  const depositBlockReasons = [
    ...getDepositBlockReasons(guardInput),
    ...(depositAmountBaseUnits === undefined ? ["deposit amount format invalid"] : []),
    ...depositRiskBlockReasons,
  ];
  const mintBlockReasons = [
    ...getMintBlockReasons(guardInput),
    ...(mintQuantityBaseUnits === undefined ? ["mint quantity format invalid"] : []),
    ...mintRiskBlockReasons,
  ];
  const depositReady = depositBlockReasons.length === 0;
  const mintReady = mintBlockReasons.length === 0;
  const activePosition =
    positionState?.positions.find((position) => position.lifecycle !== "open_unattributed" && position.lifecycle !== "redeemed") ??
    positionState?.positions.find((position) => position.lifecycle !== "open_unattributed") ??
    positionState?.positions[0];
  const activeMintEvent = activePosition?.digest ? positionState?.transactions.find((event) => event.digest === activePosition.digest) : null;
  const activeRedeemEvent = activePosition?.digest
    ? positionState?.transactions.find((event) => event.action === "redeem_binary" && event.payload?.mintDigest === activePosition.digest)
    : null;
  const activePositionTimeline = [
    {
      label: "Mint submitted",
      value: activeMintEvent?.createdAt ?? activePosition?.createdAt,
      done: Boolean(activeMintEvent ?? activePosition?.createdAt),
    },
    {
      label: "Mint confirmed",
      value: activeMintEvent?.confirmedAt,
      done: Boolean(activeMintEvent?.confirmedAt || activeMintEvent?.lifecycleStatus === "confirmed" || activeMintEvent?.lifecycleStatus === "reconciled"),
    },
    {
      label: "Expiry",
      value: activePosition?.expiry,
      done: Boolean(activePosition?.expiry && activePosition.expiry <= Date.now()),
    },
    {
      label: "Redeem",
      value: activeRedeemEvent?.confirmedAt ?? activeRedeemEvent?.createdAt,
      done: Boolean(activeRedeemEvent),
    },
  ];
  const redeemBlockReasons = getRedeemBlockReasons({
    accountConnected: Boolean(account),
    managerId,
    activePosition,
  });
  const redeemReady = redeemBlockReasons.length === 0;
  const withdrawBlockReasons = getWithdrawBlockReasons({
    accountConnected: Boolean(account),
    hasManager,
    managerOwnerMatches,
    gasReady,
    canWithdrawQuote: Boolean(positionState?.lifecycle.canWithdrawQuote),
    managerHasDusdc,
  });
  const withdrawBlockedReason = withdrawBlockReasons[0] ?? null;
  const withdrawReady = withdrawBlockedReason === null;
  const lifecycleSteps = [
    {
      label: "Connect",
      status: account ? "done" : "active",
      detail: account ? shortAddress(account.address) : "Connect a Sui Testnet wallet.",
    },
    {
      label: "Manager",
      status: hasManager && managerOwnerMatches ? "done" : account ? "active" : "pending",
      detail: hasManager && managerOwnerMatches ? shortAddress(managerId) : "Create or load this wallet's PredictManager.",
    },
    {
      label: "Fund",
      status: managerHasDusdc ? "done" : hasManager && managerOwnerMatches ? "active" : "pending",
      detail: managerHasDusdc ? `${formatBaseUnits(managerQuoteBalance)} DUSDC in manager.` : "Deposit DUSDC into the manager.",
    },
    {
      label: "Mint",
      status: activePosition && activePosition.lifecycle !== "redeemed" ? "done" : mintReady ? "active" : managerHasDusdc ? "blocked" : "pending",
      detail:
        activePosition && activePosition.lifecycle !== "redeemed"
          ? String(activePosition.lifecycle).replaceAll("_", " ")
          : mintReady
            ? "Dry-run and mint the selected DeepBook Predict position."
            : mintBlockReasons[0] ?? "Waiting for an executable signal.",
    },
    {
      label: "Redeem",
      status: activePosition?.lifecycle === "redeemed" ? "done" : redeemReady ? "active" : activePosition ? "blocked" : "pending",
      detail:
        activePosition?.lifecycle === "redeemed"
          ? "Position has been redeemed."
          : redeemReady
            ? "Redeemable value is available."
            : activePosition?.redeemBlockedReason ?? "Wait for an open position to expire and become redeemable.",
    },
    {
      label: "Withdraw",
      status: withdrawReady ? "active" : positionState?.lifecycle.canWithdrawQuote ? "blocked" : "pending",
      detail: withdrawReady ? "Withdraw free DUSDC back to the wallet." : withdrawBlockedReason ?? "Complete or redeem open positions first.",
    },
  ] satisfies Array<{ label: string; status: "done" | "active" | "blocked" | "pending"; detail: string }>;
  const nextAction = !account
    ? "Connect a Sui Testnet wallet."
    : !hasManager || !managerOwnerMatches
      ? "Create or load the PredictManager owned by this wallet."
      : !gasReady
        ? "Add testnet SUI for gas before any dry-run or transaction."
        : !managerHasDusdc
          ? walletHasDusdc
            ? "Dry-run and deposit DUSDC into the PredictManager."
            : "Fund the connected wallet with DUSDC, then deposit into the manager."
          : activePosition && redeemReady
            ? "Dry-run redeem, then confirm redeem in the wallet."
            : withdrawReady && !activePosition
              ? "Withdraw available manager DUSDC back to the wallet."
              : mintReady
                ? "Dry-run mint, then confirm mint in the wallet."
                : mintBlockReasons[0] ?? withdrawBlockedReason ?? "Refresh status and wait for a safe next action.";
  const activeBlockers = [
    ...depositBlockReasons.map((reason) => `Deposit: ${reason}`),
    ...mintBlockReasons.map((reason) => `Mint: ${reason}`),
    ...(redeemReady ? [] : [`Redeem: ${redeemBlockReasons[0] ?? "no redeemable persisted position"}`]),
    ...(withdrawReady || !withdrawBlockedReason ? [] : [`Withdraw: ${withdrawBlockedReason}`]),
  ].slice(0, 5);

  useEffect(() => {
    Promise.all([fetchDeepBookStatus(undefined, account?.address), fetchDeepBookPositions(undefined, account?.address)])
      .then(([status, positions]) => {
        setDeepBookStatus(status);
        setPositionState(positions);
        if (status.walletBinding?.managerId) {
          setManagerId(status.walletBinding.managerId);
          setBindingStatus(`Loaded manager binding for ${shortAddress(status.walletBinding.owner)}.`);
        } else if (status.configuredManagerId) {
          setManagerId((current) => current || status.configuredManagerId);
          setBindingStatus("Using configured manager until this wallet has its own binding.");
        }
      })
      .catch((error: unknown) => {
        setTxStatus(error instanceof Error ? error.message : "Unable to read DeepBook status.");
      });
  }, [account?.address]);

  useEffect(() => {
    if (!managerId || !managerIdValid) return;
    Promise.all([fetchDeepBookStatus(managerId, account?.address), fetchDeepBookPositions(managerId, account?.address)])
      .then(([status, positions]) => {
        setDeepBookStatus(status);
        setPositionState(positions);
      })
      .catch((error: unknown) => {
        setTxStatus(error instanceof Error ? error.message : "Unable to refresh PredictManager status.");
      });
  }, [managerId, managerIdValid, account?.address]);

  useEffect(() => {
    if (!account || !managerId || !hasManager || !managerOwnerMatches) return;
    bindDeepBookManager({ owner: account.address, managerId, source: "wallet_ui_verified_owner" })
      .then((result) => {
        setBindingStatus(`Saved manager binding for ${shortAddress(result.binding.owner)}.`);
      })
      .catch((error: unknown) => {
        setBindingStatus(error instanceof Error ? error.message : "Unable to save manager binding.");
      });
  }, [account?.address, managerId, hasManager, managerOwnerMatches]);

  useEffect(() => {
    let cancelled = false;

    if (!account) {
      setBalance("--");
      setSuiMistBalance(0n);
      setDusdcBalance(0n);
      setDusdcCoinCount(0);
      return;
    }

    async function refreshWalletBalances() {
      if (!account) return;
      const [sui, dusdc, dusdcCoins] = await Promise.all([
        client.getBalance({ owner: account.address }),
        client.getBalance({ owner: account.address, coinType: QUOTE_ASSET_TYPE }),
        client.listCoins({ owner: account.address, coinType: QUOTE_ASSET_TYPE, limit: 50 }),
      ]);
      if (cancelled) return;
      setSuiMistBalance(BigInt(sui.balance.balance));
      setBalance((Number(sui.balance.balance) / 1_000_000_000).toFixed(3));
      setDusdcBalance(BigInt(dusdc.balance.balance));
      setDusdcCoinCount(dusdcCoins.objects.length);
    }

    refreshWalletBalances().catch(() => {
      if (!cancelled) {
        setBalance("unavailable");
        setSuiMistBalance(0n);
        setDusdcBalance(0n);
        setDusdcCoinCount(0);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [account, client]);

  useEffect(() => {
    flushPendingChainRecords().catch(() => {
      setRecoveryStatus(`${readPendingChainRecords().length} transaction record(s) still pending local recovery.`);
    });
  // Pending record recovery should run once when the wallet context becomes available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.address]);

  async function refreshStatus() {
    const [status, positions] = await Promise.all([fetchDeepBookStatus(managerId || undefined, account?.address), fetchDeepBookPositions(managerId || undefined, account?.address)]);
    setDeepBookStatus(status);
    setPositionState(positions);
    if (account) {
      const [sui, dusdc, dusdcCoins] = await Promise.all([
        client.getBalance({ owner: account.address }),
        client.getBalance({ owner: account.address, coinType: QUOTE_ASSET_TYPE }),
        client.listCoins({ owner: account.address, coinType: QUOTE_ASSET_TYPE, limit: 50 }),
      ]);
      setSuiMistBalance(BigInt(sui.balance.balance));
      setBalance((Number(sui.balance.balance) / 1_000_000_000).toFixed(3));
      setDusdcBalance(BigInt(dusdc.balance.balance));
      setDusdcCoinCount(dusdcCoins.objects.length);
    }
  }

  async function flushPendingChainRecords() {
    const records = readPendingChainRecords();
    if (records.length === 0) {
      setRecoveryStatus("");
      return;
    }
    let recovered = 0;
    let failed = 0;
    for (const record of records) {
      try {
        await recordDeepBookTransaction(record.payload);
        removePendingChainRecord(record.digest);
        recovered += 1;
      } catch {
        failed += 1;
      }
    }
    setRecoveryStatus(
      failed > 0
        ? `${failed} transaction record(s) still pending local recovery.`
        : recovered > 0
          ? `Recovered ${recovered} pending transaction record(s).`
          : "",
    );
    if (recovered > 0) await refreshStatus();
  }

  async function recordChainTransactionWithRecovery(payload: Record<string, unknown>) {
    const normalizedPayload: Record<string, unknown> = { lifecycleStatus: "confirmed", ...payload };
    try {
      await recordDeepBookTransaction(normalizedPayload);
      if (typeof normalizedPayload.digest === "string") removePendingChainRecord(normalizedPayload.digest);
      setRecoveryStatus("");
    } catch {
      const count = queuePendingChainRecord(normalizedPayload);
      setRecoveryStatus(`Transaction is on-chain but local API recording failed. ${count} record(s) queued for recovery.`);
    }
  }

  async function loadWalletManagerBinding() {
    if (!account) {
      setBindingStatus("Connect wallet before loading manager binding.");
      return;
    }
    try {
      const result = await fetchDeepBookManagerBinding(account.address);
      if (result.binding) {
        setManagerId(result.binding.managerId);
        setBindingStatus(`Loaded manager binding for ${shortAddress(result.binding.owner)}.`);
      } else {
        setBindingStatus("No manager binding found for this wallet.");
      }
    } catch (error) {
      setBindingStatus(error instanceof Error ? error.message : "Unable to load manager binding.");
    }
  }

  async function saveWalletManagerBinding() {
    if (!account) {
      setBindingStatus("Connect wallet before saving manager binding.");
      return;
    }
    if (!managerId || !managerIdValid) {
      setBindingStatus("Enter a valid PredictManager ID before saving.");
      return;
    }
    try {
      const result = await bindDeepBookManager({ owner: account.address, managerId, source: "wallet_ui_manual" });
      setBindingStatus(`Saved manager binding for ${shortAddress(result.binding.owner)}.`);
      await refreshStatus();
    } catch (error) {
      setBindingStatus(error instanceof Error ? error.message : "Unable to save manager binding.");
    }
  }

  async function simulate(tx: Transaction) {
    if (!account) throw new Error("Wallet is not connected.");
    if (!gasReady) throw new Error("SUI gas balance is below the 0.05 SUI safety buffer.");
    tx.setSender(account.address);
    tx.setGasBudget(30_000_000);
    const result = await client.simulateTransaction({
      transaction: tx,
      include: { effects: true, balanceChanges: true },
    });
    if (result.FailedTransaction) {
      throw new Error(result.FailedTransaction.status?.error?.message ?? "Dry-run failed.");
    }
    return result;
  }

  async function buildCreateManagerIntent() {
    const intent = await createDeepBookIntent({ action: "create_manager", account: account?.address });
    setIntentText(JSON.stringify(intent, null, 2));
    setTxStatus("Create-manager intent built. Execution requires wallet confirmation.");
  }

  async function resolveCreatedManagerId(result: unknown, digest: string) {
    const fromWalletResult = extractCreatedPredictManagerId(result, PACKAGE_ID);
    if (fromWalletResult) return fromWalletResult;
    const confirmed = await client.waitForTransaction({
      digest,
      include: { effects: true, objectTypes: true },
      timeout: 30_000,
    });
    return extractCreatedPredictManagerId(confirmed, PACKAGE_ID);
  }

  async function bindCreatedManagerWithRetry(createdManagerId: string) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await bindDeepBookManager({ owner: account!.address, managerId: createdManagerId, source: "wallet_ui_create_manager" });
      } catch (error) {
        lastError = error;
        setBindingStatus(`Manager created; waiting for Predict indexing before saving binding (${attempt}/5).`);
        await sleep(2_000);
      }
    }
    throw lastError;
  }

  async function executeCreateManager() {
    if (!account) {
      setTxStatus("Wallet is not connected.");
      return;
    }
    const tx = new Transaction();
    tx.moveCall({ target: `${PACKAGE_ID}::predict::create_manager` });
    setTxStatus("Waiting for wallet confirmation...");
    try {
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest = resultDigest(result);
      setTxDigest(digest === "digest pending" ? null : digest);
      setTxStatus(`Create manager submitted, waiting for manager object: ${digest}`);
      let createdManagerId: string | null = null;
      if (digest !== "digest pending") {
        createdManagerId = await resolveCreatedManagerId(result, digest);
        if (createdManagerId) {
          setManagerId(createdManagerId);
          try {
            const binding = await bindCreatedManagerWithRetry(createdManagerId);
            setBindingStatus(`Created and saved manager binding for ${shortAddress(binding.binding.owner)}.`);
          } catch (bindingError) {
            setBindingStatus(bindingError instanceof Error ? bindingError.message : "Manager created, but binding save failed. Retry after Predict indexing catches up.");
          }
        } else {
          setBindingStatus("Manager transaction confirmed, but the manager object was not found in effects. Load or paste the Manager ID after indexing.");
        }
        await recordChainTransactionWithRecovery({
          digest,
          action: "create_manager",
          status: "success",
          owner: account?.address,
          managerId: createdManagerId ?? undefined,
          payload: { source: "wallet_ui" },
        });
      }
      setTxStatus(createdManagerId ? `Create manager confirmed: ${shortAddress(createdManagerId)} (${digest})` : `Create manager submitted: ${digest}`);
      await refreshStatus();
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Create manager transaction failed.");
    }
  }

  async function buildDepositIntent() {
    try {
      if (!managerId || !managerIdValid) throw new Error("A valid PredictManager ID is required before deposit intent preview.");
      const quantity = parseBaseUnits(depositAmount).toString();
      const intent = await createDeepBookIntent({ action: "deposit_quote", account: account?.address, managerId, quantity: Number(quantity) });
      setIntentText(JSON.stringify(intent, null, 2));
      setTxStatus("Deposit intent built. Real deposit requires DUSDC, dry-run, and wallet confirmation.");
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Unable to build deposit intent.");
    }
  }

  async function buildDepositTransaction() {
    if (!account) throw new Error("Wallet is not connected.");
    if (!managerId) throw new Error("PredictManager ID is required.");
    if (!managerIdValid) throw new Error("PredictManager ID format is invalid.");
    if (!gasReady) throw new Error("SUI gas balance is below the 0.05 SUI safety buffer.");

    const amount = parseBaseUnits(depositAmount);
    if (amount <= 0n) throw new Error("Deposit amount must be positive.");
    if (dusdcBalance < amount) throw new Error(`Wallet DUSDC is insufficient: ${formatBaseUnits(dusdcBalance)} available.`);

    const coins = await client.listCoins({ owner: account.address, coinType: QUOTE_ASSET_TYPE, limit: 50 });
    if (coins.objects.length === 0) throw new Error("No DUSDC coin objects found in the connected wallet.");

    const total = coins.objects.reduce((sum, coin) => sum + BigInt(coin.balance), 0n);
    if (total < amount) throw new Error(`DUSDC coin total is insufficient: ${formatBaseUnits(total)} available.`);

    const tx = new Transaction();
    const primary = coins.objects[0];
    const primaryObject = tx.object(primary.objectId);
    const mergeSources = coins.objects.slice(1).map((coin) => tx.object(coin.objectId));
    if (mergeSources.length > 0) {
      tx.mergeCoins(primaryObject, mergeSources);
    }

    const depositCoin = amount === total ? primaryObject : tx.splitCoins(primaryObject, [amount])[0];
    tx.moveCall({
      target: `${PACKAGE_ID}::predict_manager::deposit`,
      typeArguments: [QUOTE_ASSET_TYPE],
      arguments: [tx.object(managerId), depositCoin],
    });
    return tx;
  }

  async function dryRunDeposit() {
    setTxStatus("Dry-running DUSDC deposit...");
    try {
      await simulate(await buildDepositTransaction());
      setTxStatus("Deposit dry-run passed. You can execute the DUSDC deposit after wallet confirmation.");
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Deposit dry-run failed.");
    }
  }

  async function executeDeposit() {
    setTxStatus("Dry-running DUSDC deposit before wallet confirmation...");
    try {
      const tx = await buildDepositTransaction();
      await simulate(tx);
      setTxStatus("Waiting for wallet confirmation to deposit DUSDC...");
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest = resultDigest(result);
      setTxDigest(digest === "digest pending" ? null : digest);
      setTxStatus(`DUSDC deposit submitted: ${digest}`);
      if (digest !== "digest pending") {
        await recordChainTransactionWithRecovery({
          digest,
          action: "deposit_quote",
          status: "success",
          owner: account?.address,
          managerId,
          quantity: parseBaseUnits(depositAmount).toString(),
          payload: { source: "wallet_ui", displayAmount: depositAmount },
        });
      }
      await refreshStatus();
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "DUSDC deposit failed.");
    }
  }

  async function buildMintIntent() {
    if (!selected.surface || !selected.point) {
      setTxStatus("No DeepBook surface point is available.");
      return;
    }
    if (!oracleId) {
      setTxStatus("A real oracle ID is required before mint intent preview.");
      setIntentText("No mint preview built.");
      return;
    }
    const intent = await createDeepBookIntent({
      action: "preview_binary",
      account: account?.address,
      managerId,
      oracleId,
      expiry: selected.surface.expiry,
      strike: Number(toChainStrike(selected.point.strike)),
      quantity: Number(parseBaseUnits(mintQuantity)),
      direction: "up",
    }).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : "Unable to build mint intent. Manager and oracle IDs are required.",
    }));
    setIntentText(JSON.stringify(intent, null, 2));
    setTxStatus("Read-only mint preview built. Real mint still requires a PredictManager ID, balance, and wallet confirmation.");
  }

  function buildLocalMintTransaction() {
    if (!selected.surface || !selected.point || !managerId || !oracleId) {
      setTxStatus("Manager ID and a real oracle ID are required before mint transaction construction.");
      return null;
    }
    if (!managerIdValid) {
      setTxStatus("PredictManager ID format is invalid.");
      return null;
    }
    const quantity = parseBaseUnits(mintQuantity);
    const chainStrike = toChainStrike(selected.point.strike);
    const tx = new Transaction();
    const marketKey = tx.moveCall({
      target: `${PACKAGE_ID}::market_key::up`,
      arguments: [tx.pure.id(oracleId), tx.pure.u64(selected.surface.expiry), tx.pure.u64(chainStrike)],
    });
    tx.moveCall({
      target: `${PACKAGE_ID}::predict::mint`,
      typeArguments: [QUOTE_ASSET_TYPE],
      arguments: [
        tx.object(PREDICT_OBJECT_ID),
        tx.object(managerId),
        tx.object(oracleId),
        marketKey,
        tx.pure.u64(quantity),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
    setTxStatus("Local testnet mint transaction constructed, but not submitted.");
    return tx;
  }

  async function dryRunMint() {
    if (!mintReady) {
      setTxStatus("Mint is blocked until wallet, gas, manager DUSDC balance, fresh oracle, and an executable trade signal are ready.");
      return;
    }
    setTxStatus("Dry-running DeepBook Predict mint...");
    try {
      const tx = buildLocalMintTransaction();
      if (!tx) return;
      await simulate(tx);
      setTxStatus("Mint dry-run passed. Execution remains behind wallet confirmation.");
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Mint dry-run failed.");
    }
  }

  async function executeMint() {
    if (!mintReady) {
      setTxStatus("Mint is blocked until wallet, gas, manager DUSDC balance, fresh oracle, and an executable trade signal are ready.");
      return;
    }
    setTxStatus("Dry-running mint before wallet confirmation...");
    try {
      const tx = buildLocalMintTransaction();
      if (!tx) return;
      await simulate(tx);
      setTxStatus("Waiting for wallet confirmation to mint position...");
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest = resultDigest(result);
      setTxDigest(digest === "digest pending" ? null : digest);
      setTxStatus(`Mint submitted: ${digest}`);
      if (digest !== "digest pending" && selected.surface && selected.point && oracleId) {
        await recordChainTransactionWithRecovery({
          digest,
          action: "mint_binary",
          status: "success",
          owner: account?.address,
          managerId,
          oracleId,
          expiry: selected.surface.expiry,
          strike: toChainStrike(selected.point.strike).toString(),
          direction: "up",
          quantity: parseBaseUnits(mintQuantity).toString(),
          payload: { source: "wallet_ui", displayStrike: selected.point.strike, displayQuantity: mintQuantity },
        });
      }
      await refreshStatus();
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Mint transaction failed.");
    }
  }

  async function buildRedeemIntent() {
    if (!activePosition?.oracleId || !activePosition.expiry || !activePosition.strike || !activePosition.quantity) {
      setTxStatus("No persisted mint position is available for redeem preview.");
      return;
    }
    const intent = await createDeepBookIntent({
      action: "redeem_binary",
      managerId,
      oracleId: activePosition.oracleId,
      expiry: activePosition.expiry,
      strike: Number(activePosition.strike),
      quantity: Number(activePosition.quantity),
      direction: activePosition.direction === "down" ? "down" : "up",
    });
    setIntentText(JSON.stringify(intent, null, 2));
    setTxStatus("Redeem intent built. Execution remains disabled until the position is redeemable.");
  }

  function buildLocalRedeemTransaction() {
    if (!activePosition?.oracleId || !activePosition.expiry || !activePosition.strike || !activePosition.quantity) {
      setTxStatus("No persisted mint position is available for redeem transaction construction.");
      return null;
    }
    const tx = new Transaction();
    const direction = activePosition.direction === "down" ? "down" : "up";
    const marketKey = tx.moveCall({
      target: `${PACKAGE_ID}::market_key::${direction}`,
      arguments: [tx.pure.id(activePosition.oracleId), tx.pure.u64(activePosition.expiry), tx.pure.u64(BigInt(activePosition.strike))],
    });
    tx.moveCall({
      target: `${PACKAGE_ID}::predict::redeem`,
      typeArguments: [QUOTE_ASSET_TYPE],
      arguments: [
        tx.object(PREDICT_OBJECT_ID),
        tx.object(managerId),
        tx.object(activePosition.oracleId),
        marketKey,
        tx.pure.u64(BigInt(activePosition.quantity)),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
    setTxStatus("Local redeem transaction constructed, but not submitted.");
    return tx;
  }

  async function dryRunRedeem() {
    if (!redeemReady) {
      setTxStatus(activePosition?.redeemBlockedReason ?? "Redeem is blocked until a persisted position becomes redeemable.");
      return;
    }
    setTxStatus("Dry-running DeepBook Predict redeem...");
    try {
      const tx = buildLocalRedeemTransaction();
      if (!tx) return;
      await simulate(tx);
      setTxStatus("Redeem dry-run passed. Execution remains behind wallet confirmation.");
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Redeem dry-run failed.");
    }
  }

  async function executeRedeem() {
    if (!redeemReady || !activePosition) {
      setTxStatus(activePosition?.redeemBlockedReason ?? "Redeem is blocked until a persisted position becomes redeemable.");
      return;
    }
    setTxStatus("Dry-running redeem before wallet confirmation...");
    try {
      const tx = buildLocalRedeemTransaction();
      if (!tx) return;
      await simulate(tx);
      setTxStatus("Waiting for wallet confirmation to redeem position...");
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest = resultDigest(result);
      setTxDigest(digest === "digest pending" ? null : digest);
      setTxStatus(`Redeem submitted: ${digest}`);
      if (digest !== "digest pending") {
        await recordChainTransactionWithRecovery({
          digest,
          action: "redeem_binary",
          status: "success",
          owner: account?.address,
          managerId,
          oracleId: activePosition.oracleId,
          expiry: activePosition.expiry,
          strike: activePosition.strike,
          direction: activePosition.direction,
          quantity: activePosition.quantity,
          payload: { source: "wallet_ui", mintDigest: activePosition.digest },
        });
      }
      await refreshStatus();
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Redeem transaction failed.");
    }
  }

  async function buildWithdrawIntent() {
    try {
      const quantity = parseBaseUnits(withdrawAmount).toString();
      const intent = await createDeepBookIntent({ action: "withdraw_quote", managerId, quantity: Number(quantity) });
      setIntentText(JSON.stringify(intent, null, 2));
      setTxStatus("Withdraw intent built. Real withdraw requires dry-run and wallet confirmation.");
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Unable to build withdraw intent.");
    }
  }

  function buildLocalWithdrawTransaction() {
    if (!managerId) {
      setTxStatus("PredictManager ID is required for withdraw.");
      return null;
    }
    const amount = parseBaseUnits(withdrawAmount);
    if (amount <= 0n) throw new Error("Withdraw amount must be positive.");
    if (amount > managerQuoteBalance) throw new Error(`Manager DUSDC balance is insufficient: ${formatBaseUnits(managerQuoteBalance)} available.`);
    const tx = new Transaction();
    const coin = tx.moveCall({
      target: `${PACKAGE_ID}::predict_manager::withdraw`,
      typeArguments: [QUOTE_ASSET_TYPE],
      arguments: [tx.object(managerId), tx.pure.u64(amount)],
    });
    if (account) tx.transferObjects([coin], tx.pure.address(account.address));
    setTxStatus("Local withdraw transaction constructed, but not submitted.");
    return tx;
  }

  async function dryRunWithdraw() {
    if (!withdrawReady) {
      setTxStatus("Withdraw is blocked until wallet, manager, gas, and manager DUSDC balance are ready.");
      return;
    }
    setTxStatus("Dry-running DUSDC withdraw...");
    try {
      const tx = buildLocalWithdrawTransaction();
      if (!tx) return;
      await simulate(tx);
      setTxStatus("Withdraw dry-run passed. Execution remains behind wallet confirmation.");
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Withdraw dry-run failed.");
    }
  }

  async function executeWithdraw() {
    if (!withdrawReady) {
      setTxStatus("Withdraw is blocked until wallet, manager, gas, and manager DUSDC balance are ready.");
      return;
    }
    setTxStatus("Dry-running withdraw before wallet confirmation...");
    try {
      const tx = buildLocalWithdrawTransaction();
      if (!tx) return;
      await simulate(tx);
      setTxStatus("Waiting for wallet confirmation to withdraw DUSDC...");
      const result = await kit.signAndExecuteTransaction({ transaction: tx });
      const digest = resultDigest(result);
      setTxDigest(digest === "digest pending" ? null : digest);
      setTxStatus(`Withdraw submitted: ${digest}`);
      if (digest !== "digest pending") {
        await recordChainTransactionWithRecovery({
          digest,
          action: "withdraw_quote",
          status: "success",
          owner: account?.address,
          managerId,
          quantity: parseBaseUnits(withdrawAmount).toString(),
          payload: { source: "wallet_ui", displayAmount: withdrawAmount },
        });
      }
      await refreshStatus();
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Withdraw transaction failed.");
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sui Wallet & DeepBook Testnet</h2>
          <p className="text-sm text-terminal-muted">Connected-wallet lifecycle for real DeepBook Predict Sui Testnet execution.</p>
        </div>
        <WalletCards className="h-5 w-5 text-terminal-cyan" />
      </div>
      <div className="mt-5 rounded-md border border-cyan-300/20 bg-cyan-300/[0.04] p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-terminal-cyan">Next Safe Action</p>
            <p className="mt-2 text-base text-slate-100">{nextAction}</p>
          </div>
          <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={refreshStatus}>
            Refresh status
          </button>
        </div>
        {activeBlockers.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeBlockers.map((reason) => (
              <span key={reason} className="rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">
                {reason}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {lifecycleSteps.map((step) => (
          <LifecycleStep key={step.label} label={step.label} status={step.status} detail={step.detail} />
        ))}
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <ConnectButton />
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-terminal-muted">Network: testnet</p>
            <p>Account: {account ? shortAddress(account.address) : "not connected"}</p>
            <p>SUI balance: {balance}</p>
            <p>DUSDC wallet: {formatBaseUnits(dusdcBalance)} ({dusdcCoinCount} coin objects)</p>
          </div>
          <div className="mt-4 grid gap-2">
            <ReadinessItem label="Manager" ready={hasManager} detail={hasManager ? shortAddress(managerId) : "Create or enter a PredictManager ID"} />
            <ReadinessItem label="Gas" ready={gasReady} detail={gasReady ? "SUI gas buffer is ready." : "Need at least 0.05 testnet SUI for dry-run and execution."} />
            <ReadinessItem label="DUSDC" ready={managerHasDusdc} detail={`Manager balance ${formatBaseUnits(managerQuoteBalance)} DUSDC`} />
            <ReadinessItem
              label="Oracle"
              ready={oracleFresh}
              detail={oracleId ? `${shortAddress(oracleId)} · ${oracleStatus ?? "unknown"} · lag ${oracleLagSeconds ?? "--"}s · strike ${selectedStrike.toLocaleString()}` : "No real OracleSVI selected"}
            />
            <ReadinessItem
              label="Signal"
              ready={hasExecutableTrade}
              detail={hasExecutableTrade ? "At least one opportunity is executable." : "Current opportunities are rejected or watch-only; mint execution is hidden behind rejection."}
            />
          </div>
          <div className="mt-4 grid gap-2">
            <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={buildCreateManagerIntent}>
              Build manager intent
            </button>
            <button className="rounded border border-green-300/40 px-3 py-2 text-sm text-terminal-green" onClick={executeCreateManager} disabled={!account}>
              Execute create_manager
            </button>
          </div>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="manager-id">PredictManager ID</label>
          <input
            id="manager-id"
            className={`mt-2 w-full rounded border bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan-300/50 ${managerIdValid ? "border-white/10" : "border-red-300/50"}`}
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
            placeholder="0x..."
          />
          <p className={`mt-2 text-xs ${managerIdValid ? "text-terminal-muted" : "text-terminal-red"}`}>
            {managerIdValid ? "Manager ID is checked before status refresh and transaction build." : "Manager ID must be a 32-byte Sui object ID."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={loadWalletManagerBinding}>
              Load wallet manager
            </button>
            <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={saveWalletManagerBinding}>
              Save verified manager
            </button>
            <p className="text-xs text-terminal-muted">{bindingStatus}</p>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="deposit-amount">
              Deposit DUSDC
              <input
                id="deposit-amount"
                className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50"
                value={depositAmount}
                onChange={(event) => setDepositAmount(event.target.value)}
              />
            </label>
            <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="mint-quantity">
              Mint Quantity
              <input
                id="mint-quantity"
                className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50"
                value={mintQuantity}
                onChange={(event) => setMintQuantity(event.target.value)}
              />
            </label>
            <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="withdraw-amount">
              Withdraw DUSDC
              <input
                id="withdraw-amount"
                className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={buildDepositIntent}>
              Build deposit intent
            </button>
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={dryRunDeposit} disabled={!depositReady}>
              Dry-run deposit
            </button>
            <button className="rounded border border-green-300/40 px-3 py-2 text-sm text-terminal-green" onClick={executeDeposit} disabled={!depositReady}>
              Execute deposit
            </button>
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={buildMintIntent}>
              Preview mint intent
            </button>
            <button className="rounded border border-amber-300/40 px-3 py-2 text-sm text-terminal-amber" onClick={buildLocalMintTransaction}>
              Build local mint tx
            </button>
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={dryRunMint} disabled={!mintReady}>
              Dry-run mint
            </button>
            <button className="rounded border border-green-300/40 px-3 py-2 text-sm text-terminal-green" onClick={executeMint} disabled={!mintReady}>
              Execute mint
            </button>
            <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={refreshStatus}>
              Refresh position
            </button>
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={buildRedeemIntent}>
              Preview redeem
            </button>
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={dryRunRedeem} disabled={!redeemReady}>
              Dry-run redeem
            </button>
            <button className="rounded border border-green-300/40 px-3 py-2 text-sm text-terminal-green" onClick={executeRedeem} disabled={!redeemReady}>
              Execute redeem
            </button>
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={buildWithdrawIntent}>
              Preview withdraw
            </button>
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={dryRunWithdraw} disabled={!withdrawReady}>
              Dry-run withdraw
            </button>
            <button className="rounded border border-green-300/40 px-3 py-2 text-sm text-terminal-green" onClick={executeWithdraw} disabled={!withdrawReady}>
              Execute withdraw
            </button>
          </div>
          <div className="mt-3 rounded border border-white/10 bg-black/20 p-3 text-xs text-terminal-muted">
            <p className="font-semibold uppercase tracking-[0.14em] text-slate-300">Blocked Reasons</p>
            <p className="mt-2">Deposit: {depositBlockReasons.length > 0 ? depositBlockReasons.join("; ") : "ready"}</p>
            <p className="mt-1">Mint: {mintBlockReasons.length > 0 ? mintBlockReasons.join("; ") : "ready"}</p>
            <p className="mt-1">Redeem: {redeemReady ? "ready" : activePosition?.redeemBlockedReason ?? "no persisted position"}</p>
            <p className="mt-1">Settlement: protocol-side OracleSVICap is required; this wallet waits for redeemable value.</p>
            <p className="mt-1">Withdraw: {withdrawReady ? "ready" : withdrawBlockedReason}</p>
          </div>
          <div className="mt-3 rounded border border-white/10 bg-black/20 p-3 text-xs text-terminal-muted">
            <p className="font-semibold uppercase tracking-[0.14em] text-slate-300">Wallet Risk Limits</p>
            <p className="mt-2">Max deposit: {formatBaseUnits(MAX_DEPOSIT_BASE_UNITS)} DUSDC</p>
            <p className="mt-1">Max mint: {formatBaseUnits(MAX_MINT_BASE_UNITS)} DUSDC</p>
            <p className="mt-1">Max open exposure: {formatBaseUnits(MAX_OPEN_EXPOSURE_BASE_UNITS)} DUSDC</p>
          </div>
          <div className="mt-3 rounded border border-white/10 bg-black/20 p-3 text-xs text-terminal-muted">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold uppercase tracking-[0.14em] text-slate-300">Real Testnet Position</p>
              <p>{positionState?.lifecycle.openPositions ?? 0} open · {positionState?.lifecycle.awaitingSettlementPositions ?? 0} settling</p>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              <p>Trading balance: {formatBaseUnits(positionState?.managerSummary?.trading_balance ?? 0)} DUSDC</p>
              <p>Open exposure: {formatBaseUnits(positionState?.managerSummary?.open_exposure ?? 0)} DUSDC</p>
              <p>Redeemable: {formatBaseUnits(positionState?.managerSummary?.redeemable_value ?? 0)} DUSDC</p>
            </div>
            {activePosition ? (
              <div className="mt-3 rounded border border-white/10 bg-white/[0.03] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-slate-200">
                  <p className="font-medium">{String(activePosition.lifecycle).replaceAll("_", " ")}</p>
                  <p>{activePosition.direction ?? "up"} · strike {String(activePosition.displayStrike ?? activePosition.strike ?? "--")}</p>
                </div>
                <p className="mt-2">Oracle: {activePosition.oracleId ? shortAddress(activePosition.oracleId) : "not persisted"}</p>
                <p className="mt-1">Quantity: {activePosition.quantity ? formatBaseUnits(activePosition.quantity) : "--"} · Expiry: {activePosition.expiry ? new Date(activePosition.expiry).toLocaleString() : "--"}</p>
                <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 md:grid-cols-3">
                  <p>Mint notional: {activePosition.quantity ? `${formatBaseUnits(activePosition.quantity)} DUSDC` : "--"}</p>
                  <p>Unrealized PnL: {formatBaseUnits(positionState?.managerSummary?.unrealized_pnl ?? 0)} DUSDC</p>
                  <p>Realized PnL: {formatBaseUnits(positionState?.managerSummary?.realized_pnl ?? 0)} DUSDC</p>
                </div>
                <div className="mt-3 grid gap-2 border-t border-white/10 pt-3 md:grid-cols-4">
                  {activePositionTimeline.map((item) => (
                    <div key={item.label} className="rounded border border-white/10 bg-black/20 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-slate-300">{item.label}</p>
                        <span className={`h-2 w-2 rounded-full ${item.done ? "bg-terminal-green" : "bg-terminal-muted"}`} />
                      </div>
                      <p className="mt-1">{item.value ? new Date(item.value).toLocaleString() : "--"}</p>
                    </div>
                  ))}
                </div>
                {activePosition.digest ? (
                  <a className="mt-2 inline-block text-terminal-cyan underline-offset-4 hover:underline" href={suiExplorerTxUrl(activePosition.digest)} target="_blank" rel="noreferrer">
                    Mint digest {shortAddress(activePosition.digest)}
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="mt-3">No persisted mint position yet.</p>
            )}
            {positionState?.transactions.length ? (
              <div className="mt-3 max-h-28 overflow-auto border-t border-white/10 pt-2">
                {positionState.transactions.slice(0, 5).map((event) => (
                  <p key={event.digest} className="truncate">
                    {event.action} · {event.lifecycleStatus} · {shortAddress(event.digest)}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-3 text-sm text-slate-300">{txStatus}</p>
          {recoveryStatus ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">
              <span>{recoveryStatus}</span>
              <button className="rounded border border-amber-200/40 px-2 py-1 text-xs uppercase tracking-[0.12em]" onClick={flushPendingChainRecords}>
                Retry
              </button>
            </div>
          ) : null}
          {txDigest ? (
            <a className="mt-2 inline-block text-sm text-terminal-cyan underline-offset-4 hover:underline" href={suiExplorerTxUrl(txDigest)} target="_blank" rel="noreferrer">
              View transaction digest
            </a>
          ) : null}
          <pre className="mt-4 max-h-52 overflow-auto rounded bg-black/30 p-3 text-xs text-terminal-muted">{intentText}</pre>
        </div>
      </div>
    </section>
  );
}

export function WalletTradePanel(props: WalletTradePanelProps) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <WalletTradeContent {...props} />
    </DAppKitProvider>
  );
}
