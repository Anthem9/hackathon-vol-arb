"use client";

import { useEffect, useMemo, useState } from "react";
import { DAppKitProvider, useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Transaction } from "@mysten/sui/transactions";
import { WalletCards } from "lucide-react";
import type { VolSurface } from "@vol-arb/core";
import { createDeepBookIntent } from "../../lib/api-client";
import { dAppKit } from "../../app/dapp-kit";

const PACKAGE_ID = "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
const PREDICT_OBJECT_ID = "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
const QUOTE_ASSET_TYPE = "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
const CLOCK_OBJECT_ID = "0x6";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function WalletTradeContent({ surfaces, oracleId }: { surfaces: VolSurface[]; oracleId?: string }) {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const kit = useDAppKit();
  const [balance, setBalance] = useState<string>("--");
  const [managerId, setManagerId] = useState("");
  const [intentText, setIntentText] = useState("No transaction intent built.");
  const [txStatus, setTxStatus] = useState("Connect Sui Wallet on testnet to build a transaction.");

  const selected = useMemo(() => {
    const surface = surfaces[0];
    const point = surface?.points[Math.floor((surface.points.length - 1) / 2)];
    return { surface, point };
  }, [surfaces]);

  useEffect(() => {
    if (!account) {
      setBalance("--");
      return;
    }
    client
      .getBalance({ owner: account.address })
      .then((result) => setBalance((Number(result.balance.balance) / 1_000_000_000).toFixed(3)))
      .catch(() => setBalance("unavailable"));
  }, [account, client]);

  async function buildCreateManagerIntent() {
    const intent = await createDeepBookIntent({ action: "create_manager", account: account?.address });
    setIntentText(JSON.stringify(intent, null, 2));
    setTxStatus("Create-manager intent built. Execution requires wallet confirmation.");
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
      setTxStatus(`Create manager submitted: ${result.Transaction?.digest ?? "digest pending"}`);
    } catch (error) {
      setTxStatus(error instanceof Error ? error.message : "Create manager transaction failed.");
    }
  }

  async function buildMintIntent() {
    if (!selected.surface || !selected.point) {
      setTxStatus("No DeepBook surface point is available.");
      return;
    }
    const intent = await createDeepBookIntent({
      action: "mint_binary",
      account: account?.address,
      managerId,
      oracleId,
      expiry: selected.surface.expiry,
      strike: selected.point.strike,
      quantity: 1_000_000,
      direction: "up",
    }).catch((error: unknown) => ({
      error: error instanceof Error ? error.message : "Unable to build mint intent. Manager and oracle IDs are required.",
    }));
    setIntentText(JSON.stringify(intent, null, 2));
      setTxStatus(
        oracleId
          ? "Mint intent preview built. Real mint still requires manager balance and wallet confirmation."
          : "Mint intent preview requested. Real mint remains blocked until a real oracle ID is available.",
      );
  }

  function buildLocalMintTransaction() {
    if (!selected.surface || !selected.point || !managerId) {
      setTxStatus("Manager ID and a real oracle ID are required before mint transaction construction.");
      return null;
    }
    const selectedOracleId = oracleId ?? window.prompt("Oracle object ID for this DeepBook Predict testnet market");
    if (!selectedOracleId) return null;
    const tx = new Transaction();
    const marketKey = tx.moveCall({
      target: `${PACKAGE_ID}::market_key::up`,
      arguments: [tx.pure.id(selectedOracleId), tx.pure.u64(selected.surface.expiry), tx.pure.u64(selected.point.strike)],
    });
    tx.moveCall({
      target: `${PACKAGE_ID}::predict::mint`,
      typeArguments: [QUOTE_ASSET_TYPE],
      arguments: [
        tx.object(PREDICT_OBJECT_ID),
        tx.object(managerId),
        tx.object(selectedOracleId),
        marketKey,
        tx.pure.u64(1_000_000),
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
    setTxStatus("Local testnet mint transaction constructed, but not submitted.");
    return tx;
  }

  return (
    <section className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sui Wallet & DeepBook Testnet</h2>
          <p className="text-sm text-terminal-muted">Wallet connection, PredictManager creation, and guarded testnet transaction scaffolding.</p>
        </div>
        <WalletCards className="h-5 w-5 text-terminal-cyan" />
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <ConnectButton />
          <div className="mt-4 space-y-2 text-sm">
            <p className="text-terminal-muted">Network: testnet</p>
            <p>Account: {account ? shortAddress(account.address) : "not connected"}</p>
            <p>SUI balance: {balance}</p>
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
            className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-cyan-300/50"
            value={managerId}
            onChange={(event) => setManagerId(event.target.value)}
            placeholder="0x..."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200" onClick={buildMintIntent}>
              Preview mint intent
            </button>
            <button className="rounded border border-amber-300/40 px-3 py-2 text-sm text-terminal-amber" onClick={buildLocalMintTransaction}>
              Build local mint tx
            </button>
          </div>
          <p className="mt-3 text-sm text-slate-300">{txStatus}</p>
          <pre className="mt-4 max-h-52 overflow-auto rounded bg-black/30 p-3 text-xs text-terminal-muted">{intentText}</pre>
        </div>
      </div>
    </section>
  );
}

export function WalletTradePanel({ surfaces, oracleId }: { surfaces: VolSurface[]; oracleId?: string }) {
  return (
    <DAppKitProvider dAppKit={dAppKit}>
      <WalletTradeContent surfaces={surfaces} oracleId={oracleId} />
    </DAppKitProvider>
  );
}
