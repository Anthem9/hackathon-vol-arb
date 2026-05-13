import assert from "node:assert/strict";
import { DEFAULT_BACKTEST_PARAMS, runBtc5mBacktestFromData, type Btc5mMarket, type PricePoint } from "./btc5m-research-service";

const start = Date.UTC(2026, 0, 1, 0, 0, 0);
const market: Btc5mMarket = {
  slug: "btc-updown-5m-1767225600",
  eventId: "event-1",
  marketId: "market-1",
  conditionId: "condition-1",
  question: "Bitcoin Up or Down",
  startTime: start,
  endTime: start + 300_000,
  upTokenId: "up-token",
  downTokenId: "down-token",
  closed: true,
  resolved: true,
  winningOutcome: "up",
  raw: {},
};

const points: PricePoint[] = [
  { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, time: start + 60_000, source: "clob_prices_history" },
  { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.95, time: start + 60_000, source: "clob_prices_history" },
  { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, time: start + 61_000, source: "clob_prices_history" },
  { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.16, time: start + 90_000, source: "clob_prices_history" },
  { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.84, time: start + 90_000, source: "clob_prices_history" },
];

const report = runBtc5mBacktestFromData({
  markets: [market],
  points,
  params: {
    ...DEFAULT_BACKTEST_PARAMS,
    initialCapital: 100,
    maxRiskFraction: 0.1,
    entryMinPrice: 0.01,
    entryMaxPrice: 0.08,
    assumedSpread: 0,
    takeProfitMultiple: 2,
    decisionDelaySeconds: 0,
    entryMaxWaitSeconds: 5,
    minSecondsRemaining: 1,
    maxSecondsRemaining: 300,
  },
});

assert.equal(report.initialCapital, 100);
assert.equal(report.tradeCount, 1);
assert.equal(report.trades[0]?.status, "sold");
assert.equal(report.trades[0]?.reason, "take_profit_limit");
assert.equal(report.trades[0]?.entryLimit, 0.05);
assert.equal(report.trades[0]?.exitLimit, 0.1);
assert.ok((report.trades[0]?.size ?? 0) <= 200);
assert.ok(report.finalCapital > report.initialCapital);
assert.ok(report.returnOnCapital > 0);
assert.equal(report.grossLoss, 0);
assert.ok(report.grossProfit > 0);
assert.equal(report.profitFactor, null);
assert.ok(report.averageTradePnl > 0);

const settleReport = runBtc5mBacktestFromData({
  markets: [market],
  points: points.slice(0, 2),
  params: {
    ...DEFAULT_BACKTEST_PARAMS,
    initialCapital: 100,
    maxRiskFraction: 0.1,
    entryMinPrice: 0.01,
    entryMaxPrice: 0.08,
    assumedSpread: 0,
    decisionDelaySeconds: 0,
    entryMaxWaitSeconds: 5,
    minSecondsRemaining: 1,
    maxSecondsRemaining: 300,
    allowHoldToSettlement: true,
  },
});

assert.equal(settleReport.tradeCount, 1);
assert.equal(settleReport.trades[0]?.status, "settled");
assert.equal(settleReport.trades[0]?.exitPrice, 1);
assert.ok(settleReport.finalCapital > report.finalCapital);

const stopLossReport = runBtc5mBacktestFromData({
  markets: [{ ...market, winningOutcome: "down" }],
  points: [
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, time: start + 60_000, source: "clob_prices_history" },
    { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.95, time: start + 60_000, source: "clob_prices_history" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, time: start + 61_000, source: "clob_prices_history" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.02, time: start + 90_000, source: "clob_prices_history" },
    { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.98, time: start + 90_000, source: "clob_prices_history" },
  ],
  params: {
    ...DEFAULT_BACKTEST_PARAMS,
    initialCapital: 100,
    maxRiskFraction: 0.1,
    entryMinPrice: 0.01,
    entryMaxPrice: 0.08,
    assumedSpread: 0,
    takeProfitMultiple: 4,
    stopLossFraction: 0.5,
    decisionDelaySeconds: 0,
    entryMaxWaitSeconds: 5,
    minSecondsRemaining: 1,
    maxSecondsRemaining: 300,
  },
});

assert.equal(stopLossReport.tradeCount, 1);
assert.equal(stopLossReport.trades[0]?.reason, "stop_loss_limit");
assert.equal(stopLossReport.trades[0]?.exitLimit, 0.02);
assert.equal(stopLossReport.trades[0]?.exitPrice, 0.02);
assert.ok(stopLossReport.totalPnl < 0);

const thinLiquidityReport = runBtc5mBacktestFromData({
  markets: [market],
  points: [
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, size: 50, time: start + 60_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.95, size: 500, time: start + 60_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, size: 50, time: start + 61_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.16, size: 500, time: start + 90_000, source: "orderbook_snapshot", side: "bid" },
  ],
  params: {
    ...DEFAULT_BACKTEST_PARAMS,
    initialCapital: 100,
    maxRiskFraction: 0.1,
    entryMinPrice: 0.01,
    entryMaxPrice: 0.08,
    assumedSpread: 0,
    decisionDelaySeconds: 0,
    entryMaxWaitSeconds: 5,
    minSecondsRemaining: 1,
    maxSecondsRemaining: 300,
  },
});

assert.equal(thinLiquidityReport.tradeCount, 0);

const bidAskSeparationReport = runBtc5mBacktestFromData({
  markets: [market],
  points: [
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.2, size: 500, time: start + 60_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, size: 500, time: start + 60_000, source: "orderbook_snapshot", side: "bid" },
    { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.8, size: 500, time: start + 60_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.2, size: 500, time: start + 61_000, source: "orderbook_snapshot", side: "ask" },
  ],
  params: {
    ...DEFAULT_BACKTEST_PARAMS,
    initialCapital: 100,
    maxRiskFraction: 0.1,
    entryMinPrice: 0.01,
    entryMaxPrice: 0.08,
    assumedSpread: 0,
    decisionDelaySeconds: 0,
    entryMaxWaitSeconds: 5,
    minSecondsRemaining: 1,
    maxSecondsRemaining: 300,
  },
});

assert.equal(bidAskSeparationReport.tradeCount, 0);

const askOnlyExitReport = runBtc5mBacktestFromData({
  markets: [market],
  points: [
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, size: 1000, time: start + 60_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.95, size: 1000, time: start + 60_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, size: 1000, time: start + 61_000, source: "orderbook_snapshot", side: "ask" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.01, size: 1000, time: start + 90_000, source: "orderbook_snapshot", side: "ask" },
  ],
  params: {
    ...DEFAULT_BACKTEST_PARAMS,
    initialCapital: 100,
    maxRiskFraction: 0.1,
    entryMinPrice: 0.01,
    entryMaxPrice: 0.08,
    assumedSpread: 0,
    decisionDelaySeconds: 0,
    entryMaxWaitSeconds: 5,
    minSecondsRemaining: 1,
    maxSecondsRemaining: 300,
    allowHoldToSettlement: true,
  },
});

assert.equal(askOnlyExitReport.tradeCount, 1);
assert.equal(askOnlyExitReport.trades[0]?.status, "settled");
assert.notEqual(askOnlyExitReport.trades[0]?.exitPrice, Number.NEGATIVE_INFINITY);

const staleSignalReport = runBtc5mBacktestFromData({
  markets: [market],
  points: [
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.05, time: start + 60_000, source: "clob_prices_history" },
    { marketSlug: market.slug, tokenId: "down-token", outcome: "down", price: 0.95, time: start + 60_000, source: "clob_prices_history" },
    { marketSlug: market.slug, tokenId: "up-token", outcome: "up", price: 0.16, time: start + 90_000, source: "clob_prices_history" },
  ],
  params: {
    ...DEFAULT_BACKTEST_PARAMS,
    initialCapital: 100,
    maxRiskFraction: 0.1,
    entryMinPrice: 0.01,
    entryMaxPrice: 0.08,
    assumedSpread: 0,
    decisionDelaySeconds: 0,
    entryMaxWaitSeconds: 60,
    maxSignalStalenessSeconds: 5,
    minSecondsRemaining: 1,
    maxSecondsRemaining: 220,
  },
});

assert.equal(staleSignalReport.tradeCount, 0);

console.log("btc5m-research-service tests passed");
