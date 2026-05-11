import assert from "node:assert/strict";
import { applyAlertOperatorActions, buildAlerts, createAlertOperatorAction } from "./alert-service";
import { createPaperTrade, getPaperTrades } from "./paper-trade-service";
import { getDashboardData } from "./dashboard-service";
import { getApiHealth } from "./health-service";
import { getMaintenanceStatus, runMaintenanceOnce } from "./maintenance-service";
import {
  buildPolymarketCancelPreview,
  buildPolymarketOrderPreview,
  executePolymarketCancel,
  executePolymarketOrder,
  getPolymarketAccountState,
  getPolymarketTradingReadiness,
} from "./polymarket-trading-service";
import { checkDatabaseConnection } from "../db/postgres";

process.env.DATA_MODE = "mock";
delete process.env.DATABASE_URL;

const dashboard = await getDashboardData();
assert.equal(dashboard.mode, "mock");
assert.ok(dashboard.alerts.length > 0, "mock dashboard should generate runtime alerts");

const alerts = buildAlerts(dashboard);
assert.ok(alerts.some((alert) => alert.ruleId.startsWith("risk-")), "risk alerts should be generated");
assert.ok(alerts.some((alert) => alert.ruleId.startsWith("svi-")), "SVI alerts should be generated");

const paperTrades = await getPaperTrades();
assert.ok(paperTrades.length >= 2, "fixture paper trades should be returned");

const response = await createPaperTrade({
  opportunityId: "opp-trade-108k-14d",
  sizeUsd: 1250,
});
assert.match(response.tradeId, /^paper-/);
assert.equal(response.opportunityId, "opp-trade-108k-14d");
assert.equal(response.status, "open");
assert.equal(typeof response.attribution.totalPnl, "number");
assert.match(response.message, /No real order was submitted/);

const paperTradesAfterCreate = await getPaperTrades();
assert.equal(paperTradesAfterCreate[0]?.tradeId, response.tradeId, "created paper trade should be queryable in fallback mode");

const alertAction = await createAlertOperatorAction({
  alertId: "risk-svi-feeder-lag:risk-control",
  action: "resolve",
});
assert.equal(alertAction.action, "resolve");

const actedAlerts = await applyAlertOperatorActions([
  {
    alertId: "risk-svi-feeder-lag:risk-control",
    ruleId: "risk-SVI feeder lag",
    title: "SVI feeder lag",
    message: "lagSeconds > 120 -> pause_opening",
    severity: "warning",
    status: "active",
    sourceId: "risk-control",
    createdAt: Date.now(),
  },
]);
assert.equal(actedAlerts[0]?.status, "resolved", "alert operator action should resolve matching alerts");

const dbStatus = await checkDatabaseConnection();
assert.equal(dbStatus.enabled, false, "database check should be disabled when DATABASE_URL is absent");

const health = await getApiHealth();
assert.equal(health.service, "vol-arb-api");
assert.equal(health.database.enabled, false);
assert.equal(health.sources, null);
assert.equal(typeof health.uptimeSeconds, "number");

const originalFetch = globalThis.fetch;
const futureExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
process.env.DATA_MODE = "hybrid";
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/oracles")) {
    return new Response(
      JSON.stringify([
        {
          oracle_id: `0x${"4".repeat(64)}`,
          underlying_asset: "BTC",
          status: "active",
          expiry: futureExpiry,
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (init?.method === "POST") {
    return new Response(
      JSON.stringify({
        result: {
          data: {
            content: {
              fields: {
                active: true,
                underlying_asset: "BTC",
                expiry: futureExpiry,
                timestamp: Date.now(),
                prices: { fields: { spot: 100_000_000_000_000, forward: 101_000_000_000_000 } },
                svi: {
                  fields: {
                    a: 120_000,
                    b: 400_000,
                    rho: { fields: { magnitude: 200_000_000, is_negative: true } },
                    m: { fields: { magnitude: 5_000, is_negative: false } },
                    sigma: 550_000,
                  },
                },
              },
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.includes("gamma-api.polymarket.com")) {
    return new Response(
      JSON.stringify([
        {
          id: "btc-test",
          conditionId: "condition-1",
          question: "Will Bitcoin be above $100k?",
          slug: "will-btc-be-above-100k",
          clobTokenIds: JSON.stringify(["token-1"]),
          liquidityNum: "50000",
          endDate: new Date(futureExpiry).toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.includes("clob.polymarket.com/book")) {
    return new Response(JSON.stringify({ bids: [{ price: "0.42" }], asks: [{ price: "0.48" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("clob.polymarket.com/midpoint")) {
    return new Response(JSON.stringify({ mid: "0.45" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("coingecko")) {
    return new Response(JSON.stringify({ bitcoin: { usd: 100000, last_updated_at: Math.floor(Date.now() / 1000) } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.includes("coinbase")) {
    return new Response(JSON.stringify({ data: { amount: "100000" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.includes("kraken")) {
    return new Response(JSON.stringify({ result: { XXBTZUSD: { c: ["100000.0", "1"] } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({}), { status: 404 });
};

const hybridDashboard = await getDashboardData();
assert.equal(hybridDashboard.mode, "hybrid");
assert.equal(hybridDashboard.overview.opportunities.trade, 0, "server-side opportunities should not be marked trade before wallet dry-run");
assert.equal(hybridDashboard.overview.maxExecutableEdge, 0, "max executable edge should be zero without a wallet dry-run-passed trade");
assert.ok(hybridDashboard.opportunities.length > 0, "real public data should still produce watchlist opportunities");
assert.ok(hybridDashboard.opportunities.every((opportunity) => opportunity.decision !== "trade"));
assert.ok(hybridDashboard.opportunities.every((opportunity) => opportunity.recommendedSizeUsd === 0));
assert.ok(
  hybridDashboard.opportunities.every((opportunity) =>
    opportunity.rejectReasons?.includes("Matching connected-wallet DeepBook Predict mint dry-run has not passed for this opportunity"),
  ),
);
const deepHealth = await getApiHealth({ deep: true });
assert.equal(deepHealth.sources?.mode, "hybrid");
assert.ok(deepHealth.sources.sourceStatuses.length > 0);
globalThis.fetch = originalFetch;
process.env.DATA_MODE = "mock";

delete process.env.SUI_TESTNET_ADDRESS;
delete process.env.DEEPBOOK_PREDICT_MANAGER_ID;
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.endsWith("/oracles")) {
    return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({}), { status: 404, headers: { "Content-Type": "application/json" } });
};
const maintenance = await runMaintenanceOnce();
assert.notEqual(maintenance.status, "failed");
assert.ok(maintenance.tasks.some((task) => task.name === "deepbook_reconcile" && task.status === "success"));
assert.ok(maintenance.tasks.some((task) => task.name === "deepbook_backfill" && task.detail.includes("SUI_TESTNET_ADDRESS")));
assert.equal(getMaintenanceStatus().lastRun?.id, maintenance.id);
globalThis.fetch = originalFetch;

process.env.POLYMARKET_API_BASE = "https://clob.polymarket.test";
process.env.POLYMARKET_DATA_API_BASE = "https://data.polymarket.test";
process.env.POLYMARKET_WALLET_ADDRESS = "0x62f94E9AC9349BCCC61Bfe66ddAdE6292702EcB6";
process.env.POLYMARKET_PRIVATE_KEY = `0x${"8".repeat(64)}`;
process.env.POLYMARKET_API_KEY = "key";
process.env.POLYMARKET_API_SECRET = Buffer.from("secret").toString("base64");
process.env.POLYMARKET_API_PASSPHRASE = "passphrase";
process.env.POLYMARKET_CHAIN_ID = "137";
process.env.POLYMARKET_ENABLE_LIVE_TRADING = "false";
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === "https://clob.polymarket.test/") return new Response("OK", { status: 200 });
  if (url.startsWith("https://clob.polymarket.test/data/orders?")) {
    assert.equal(new URL(url).searchParams.get("next_cursor"), "MA==");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("POLY_ADDRESS"), process.env.POLYMARKET_WALLET_ADDRESS);
    assert.equal(headers.get("POLY_API_KEY"), process.env.POLYMARKET_API_KEY);
    assert.equal(headers.get("POLY_PASSPHRASE"), process.env.POLYMARKET_API_PASSPHRASE);
    assert.ok(headers.get("POLY_TIMESTAMP"));
    assert.ok(headers.get("POLY_SIGNATURE"));
    return Response.json({
      limit: 100,
      next_cursor: "",
      count: 1,
      data: [
        {
          id: `0x${"a".repeat(64)}`,
          status: "ORDER_STATUS_LIVE",
          market: `0x${"b".repeat(64)}`,
          asset_id: "123",
          side: "BUY",
          original_size: "10",
          size_matched: "2",
          price: "0.42",
          outcome: "YES",
          order_type: "GTC",
          created_at: 1700000000,
        },
      ],
    });
  }
  if (url.startsWith("https://data.polymarket.test/positions?")) {
    return Response.json([
      {
        asset: "123",
        conditionId: `0x${"9".repeat(64)}`,
        size: 2,
        avgPrice: 0.4,
        initialValue: 0.8,
        currentValue: 1.2,
        cashPnl: 0.4,
        realizedPnl: 0.1,
        curPrice: 0.6,
        title: "BTC test",
        slug: "btc-test",
        outcome: "Yes",
      },
    ]);
  }
  throw new Error(`unexpected fetch ${url}`);
};
const polymarketReadiness = await getPolymarketTradingReadiness();
assert.equal(polymarketReadiness.network, "polygon");
assert.equal(polymarketReadiness.chainId, 137);
assert.equal(polymarketReadiness.capabilities.authenticatedRequests, true);
assert.equal(polymarketReadiness.capabilities.orderSubmission, false);
assert.equal(polymarketReadiness.safeMode, "read_only");
assert.ok(polymarketReadiness.blockers.includes("POLYMARKET_ENABLE_LIVE_TRADING is not true; order submission remains disabled."));
process.env.POLYMARKET_CHAIN_ID = "80002";
const polymarketAmoyReadiness = await getPolymarketTradingReadiness();
assert.equal(polymarketAmoyReadiness.network, "polygon-amoy");
assert.equal(polymarketAmoyReadiness.chainId, 80002);
assert.ok(polymarketAmoyReadiness.blockers.includes("Polymarket live trading requires POLYMARKET_CHAIN_ID=137."));
process.env.POLYMARKET_CHAIN_ID = "137";
const polymarketPreview = await buildPolymarketOrderPreview({
  market: "btc-test-market",
  tokenId: "123",
  side: "buy",
  price: "0.42",
  size: "10",
});
assert.equal(polymarketPreview.preview.notional, 4.2);
assert.equal(polymarketPreview.preview.maxLoss, 4.2);
assert.equal(polymarketPreview.preview.maxProfit, 5.800000000000001);
assert.equal(polymarketPreview.orderSubmissionReady, false);
assert.ok(polymarketPreview.blockers.includes("POLYMARKET_ENABLE_LIVE_TRADING is not true; order submission remains disabled."));
const polymarketAccount = await getPolymarketAccountState();
assert.equal(polymarketAccount.positions.length, 1);
assert.equal(polymarketAccount.totals.currentValue, 1.2);
assert.equal(polymarketAccount.totals.cashPnl, 0.4);
assert.equal(polymarketAccount.openOrders.ready, true);
assert.equal(polymarketAccount.openOrders.enabled, true);
assert.equal(polymarketAccount.orders.length, 1);
assert.equal(polymarketAccount.orders[0].price, 0.42);
const cancelPreview = await buildPolymarketCancelPreview({ orderId: `0x${"a".repeat(64)}` });
assert.equal(cancelPreview.cancelReady, false);
assert.equal(cancelPreview.cancelExecutionEnabled, false);
assert.equal(cancelPreview.order?.price, 0.42);
assert.ok(cancelPreview.blockers.includes("POLYMARKET_ENABLE_LIVE_TRADING is not true; cancel execution remains disabled."));
const blockedOrderExecution = await executePolymarketOrder({
  market: "btc-test-market",
  tokenId: "123",
  side: "buy",
  price: "0.42",
  size: "10",
  confirmation: "I understand this submits a real Polymarket order",
});
assert.equal(blockedOrderExecution.submitted, false);
assert.equal(blockedOrderExecution.executionEnabled, false);
assert.ok(blockedOrderExecution.blockers.some((blocker: string) => blocker === "POLYMARKET_ENABLE_LIVE_TRADING is not true; order submission remains disabled."));
const blockedCancelExecution = await executePolymarketCancel({
  orderId: `0x${"a".repeat(64)}`,
  confirmation: "I understand this cancels a real Polymarket order",
});
assert.equal(blockedCancelExecution.submitted, false);
assert.equal(blockedCancelExecution.executionEnabled, false);
assert.ok(blockedCancelExecution.blockers.some((blocker: string) => blocker === "POLYMARKET_ENABLE_LIVE_TRADING is not true; cancel execution remains disabled."));
globalThis.fetch = originalFetch;

console.log("runtime-services tests passed");
