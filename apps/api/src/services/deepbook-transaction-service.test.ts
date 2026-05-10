import assert from "node:assert/strict";
import {
  buildDeepBookTradeIntent,
  decodeDeepBookFailureReason,
  getDeepBookMintDryRuns,
  getDeepBookStatus,
  getDeepBookTestnetReadiness,
  recordDeepBookMintDryRun,
} from "./deepbook-transaction-service";

const managerId = `0x${"1".repeat(64)}`;
const oracleId = `0x${"2".repeat(64)}`;

const createIntent = buildDeepBookTradeIntent({ action: "create_manager" });
assert.equal(createIntent.safeMode, "wallet_sign_required");
assert.equal(createIntent.calls[0].target.endsWith("::predict::create_manager"), true);

const depositIntent = buildDeepBookTradeIntent({
  action: "deposit_quote",
  managerId,
  quantity: 1_000_000,
});
assert.equal(depositIntent.safeMode, "dry_run_first");
assert.equal(depositIntent.calls[0].target.endsWith("::predict_manager::deposit"), true);
assert.deepEqual(depositIntent.calls[0].arguments, [managerId, "Coin<DUSDC>", 1_000_000]);

const previewIntent = buildDeepBookTradeIntent({
  action: "preview_binary",
  oracleId,
  expiry: 1_800_000_000_000,
  strike: 100_000,
  quantity: 1_000_000,
});
assert.equal(previewIntent.safeMode, "read_only_preview");
assert.equal(previewIntent.calls[0].target.endsWith("::predict::get_trade_amounts"), true);

const redeemIntent = buildDeepBookTradeIntent({
  action: "redeem_binary",
  managerId,
  oracleId,
  expiry: 1_800_000_000_000,
  strike: 100_000,
  quantity: 1_000_000,
});
assert.equal(redeemIntent.safeMode, "settlement_required");
assert.equal(redeemIntent.calls[1].target.endsWith("::predict::redeem"), true);

const withdrawIntent = buildDeepBookTradeIntent({
  action: "withdraw_quote",
  managerId,
  quantity: 500_000,
});
assert.equal(withdrawIntent.safeMode, "dry_run_first");
assert.equal(withdrawIntent.calls[0].target.endsWith("::predict_manager::withdraw"), true);

assert.throws(
  () => buildDeepBookTradeIntent({ action: "deposit_quote", managerId }),
  /quantity is required/,
);

const balanceFailure = decodeDeepBookFailureReason("Insufficient gas balance for transaction");
assert.equal(balanceFailure.category, "balance");
assert.match(balanceFailure.advice, /DUSDC|SUI/);

const ownerFailure = decodeDeepBookFailureReason("MoveAbort in predict_manager: not authorized owner");
assert.equal(ownerFailure.category, "ownership");

const settlementFailure = decodeDeepBookFailureReason("redeem failed because expiry has not settled");
assert.equal(settlementFailure.category, "settlement");

const marketFailure = decodeDeepBookFailureReason("MoveAbort oracle market_key strike mismatch");
assert.equal(marketFailure.category, "market");

const networkFailure = decodeDeepBookFailureReason("RPC timeout 503");
assert.equal(networkFailure.category, "network");

const abortFailure = decodeDeepBookFailureReason("MoveAbort in module predict with code 1204");
assert.equal(abortFailure.category, "move_abort");
assert.equal(abortFailure.abortCode, "1204");

const dryRun = await recordDeepBookMintDryRun({
  owner: `0x${"9".repeat(64)}`,
  managerId,
  oracleId,
  expiry: 1_800_000_000_000,
  strike: "100000000000000",
  direction: "up",
  quantity: "100000",
  status: "success",
  dryRunDigest: "dryRunDigest",
  payload: { source: "unit_test" },
});
assert.equal(dryRun.event.owner, `0x${"9".repeat(64)}`);
assert.equal(dryRun.event.status, "success");
const dryRuns = await getDeepBookMintDryRuns({ owner: `0x${"9".repeat(64)}`, managerId });
assert.equal(dryRuns[0]?.oracleId, oracleId);
assert.equal(dryRuns[0]?.quantity, "100000");

const originalFetch = globalThis.fetch;
const originalManagerId = process.env.DEEPBOOK_PREDICT_MANAGER_ID;
const originalAddress = process.env.SUI_TESTNET_ADDRESS;
process.env.DEEPBOOK_PREDICT_MANAGER_ID = managerId;
process.env.SUI_TESTNET_ADDRESS = `0x${"3".repeat(64)}`;

globalThis.fetch = async () =>
  new Response(
    JSON.stringify({
      manager_id: managerId,
      owner: `0x${"3".repeat(64)}`,
      balances: [{ quote_asset: "e950::dusdc::DUSDC", balance: 2_000_000 }],
      trading_balance: 2_000_000,
      open_exposure: 0,
      redeemable_value: 0,
      realized_pnl: 0,
      unrealized_pnl: 0,
      account_value: 2_000_000,
      open_positions: 1,
      awaiting_settlement_positions: 0,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const readyStatus = await getDeepBookStatus();
assert.equal(readyStatus.configuredManagerId, managerId);
assert.equal(readyStatus.readiness.hasManager, true);
assert.equal(readyStatus.readiness.hasQuoteBalance, true);
assert.equal(readyStatus.readiness.nextAction, "ready_to_mint");
assert.equal(readyStatus.managerSummary?.open_positions, 1);

globalThis.fetch = async () => new Response("missing", { status: 404 });
const missingStatus = await getDeepBookStatus(managerId);
assert.equal(missingStatus.readiness.hasManager, false);
assert.equal(missingStatus.readiness.nextAction, "verify_manager");
assert.equal(missingStatus.managerError, "Predict server returned 404");

const discoveredOwner = `0x${"5".repeat(64)}`;
const discoveredManager = `0x${"6".repeat(64)}`;
delete process.env.DEEPBOOK_PREDICT_MANAGER_ID;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (init?.method === "POST") {
    const body = JSON.parse(String(init.body ?? "{}")) as { method?: string };
    assert.equal(body.method, "suix_getOwnedObjects");
    return new Response(
      JSON.stringify({
        result: {
          data: [
            {
              data: {
                objectId: discoveredManager,
                type: `${process.env.DEEPBOOK_PREDICT_PACKAGE_ID ?? "0xd0fef21d2f1676a6a331fca63f7b18a1ade94f6b6ffcc8d3d5c95ed74bd56bb0"}::predict_manager::PredictManager`,
              },
            },
          ],
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.includes(`/managers/${discoveredManager}/summary`)) {
    return new Response(
      JSON.stringify({
        manager_id: discoveredManager,
        owner: discoveredOwner,
        balances: [{ quote_asset: "e950::dusdc::DUSDC", balance: 1_000_000 }],
        trading_balance: 1_000_000,
        open_exposure: 0,
        redeemable_value: 0,
        realized_pnl: 0,
        unrealized_pnl: 0,
        account_value: 1_000_000,
        open_positions: 0,
        awaiting_settlement_positions: 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response("unexpected", { status: 500 });
};
const discoveredStatus = await getDeepBookStatus(undefined, discoveredOwner);
assert.equal(discoveredStatus.configuredManagerId, discoveredManager);
assert.equal(discoveredStatus.walletBinding?.source, "chain_discovery");
assert.equal(discoveredStatus.readiness.nextAction, "ready_to_mint");

process.env.DEEPBOOK_PREDICT_MANAGER_ID = managerId;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/oracles")) {
    return new Response(
      JSON.stringify([
        {
          oracle_id: oracleId,
          predict_id: `0x${"4".repeat(64)}`,
          underlying_asset: "BTC",
          status: "active",
          expiry: Date.now() + 60_000,
          min_strike: 1000,
          tick_size: 1000,
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.includes("/managers/")) {
    return new Response(
      JSON.stringify({
        manager_id: managerId,
        owner: process.env.SUI_TESTNET_ADDRESS,
        balances: [{ quote_asset: "e950::dusdc::DUSDC", balance: 0 }],
        trading_balance: 0,
        open_exposure: 0,
        redeemable_value: 0,
        realized_pnl: 0,
        unrealized_pnl: 0,
        account_value: 0,
        open_positions: 0,
        awaiting_settlement_positions: 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: unknown[] };
  if (body.method === "suix_getBalance") {
    const coinType = String(body.params?.[1] ?? "");
    return new Response(
      JSON.stringify({
        result: {
          totalBalance: coinType.includes("SUI") ? "10000000000" : "0",
          coinObjectCount: coinType.includes("SUI") ? 1 : 0,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ error: { message: "unexpected request" } }), { status: 500 });
};

const readiness = await getDeepBookTestnetReadiness();
assert.equal(readiness.manager.ownerMatchesConfiguredAddress, true);
assert.equal(readiness.balances.sui, 10);
assert.equal(readiness.balances.walletQuote, 0);
assert.equal(readiness.oracleCandidates[0]?.oracleId, oracleId);
assert.equal(readiness.readiness.nextAction, "wait_for_dusdc");
assert.ok(readiness.readiness.blockers.includes("Wallet DUSDC is missing; deposit dry-run is expected to be blocked"));

globalThis.fetch = originalFetch;
if (originalManagerId === undefined) {
  delete process.env.DEEPBOOK_PREDICT_MANAGER_ID;
} else {
  process.env.DEEPBOOK_PREDICT_MANAGER_ID = originalManagerId;
}
if (originalAddress === undefined) {
  delete process.env.SUI_TESTNET_ADDRESS;
} else {
  process.env.SUI_TESTNET_ADDRESS = originalAddress;
}

console.log("deepbook-transaction-service tests passed");
