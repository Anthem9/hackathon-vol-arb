import { runDatabaseQuery } from "../db/postgres";
import { createL2Headers, type ApiKeyCreds } from "@polymarket/clob-client-v2";
import { createWalletClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";

type JsonRecord = Record<string, unknown>;

export type Btc5mMarket = {
  slug: string;
  eventId: string;
  marketId: string;
  conditionId: string;
  question: string;
  startTime: number;
  endTime: number;
  upTokenId: string;
  downTokenId: string;
  closed: boolean;
  resolved: boolean;
  winningOutcome: "up" | "down" | null;
  raw: JsonRecord;
};

export type PricePoint = {
  marketSlug: string;
  tokenId: string;
  outcome: "up" | "down";
  price: number;
  time: number;
  source: "clob_prices_history" | "orderbook_snapshot" | "trade_proxy";
};

export type BacktestParams = {
  strategy: "lottery_reprice" | "probability_cone";
  initialCapital: number;
  maxRiskFraction: number;
  entryMinPrice: number;
  entryMaxPrice: number;
  entryLimitOffset: number;
  takeProfitMultiple: number;
  stopLossFraction: number;
  maxHoldSeconds: number;
  forceExitBeforeEndSeconds: number;
  minSecondsRemaining: number;
  maxSecondsRemaining: number;
  probabilityEdge: number;
  assumedSpread: number;
  decisionDelaySeconds: number;
  allowHoldToSettlement: boolean;
  maxDailyLossFraction: number;
  maxDrawdownFraction: number;
  maxConsecutiveLosses: number;
  maxOpenMarkets: number;
  useKellySizing: boolean;
  kellyFraction: number;
};

export type BacktestTrade = {
  marketSlug: string;
  tokenId: string;
  outcome: "up" | "down";
  entryTime: number;
  entryLimit: number;
  entryPrice: number;
  size: number;
  exitTime: number;
  exitLimit: number;
  exitPrice: number;
  status: "sold" | "settled" | "expired_unfilled";
  pnl: number;
  reason: string;
};

export type BacktestReport = {
  runId: string;
  strategy: string;
  parameters: BacktestParams;
  initialCapital: number;
  finalCapital: number;
  totalPnl: number;
  maxDrawdown: number;
  winRate: number;
  tradeCount: number;
  filledEntryCount: number;
  sourceBreakdown: Record<string, number>;
  segmentBreakdown: Record<string, { trades: number; pnl: number; winRate: number }>;
  trades: BacktestTrade[];
  notes: string[];
};

export type PaperSignalReport = {
  signalId: string;
  marketSlug: string | null;
  decision: "would_enter" | "no_signal" | "blocked";
  strategy: BacktestParams["strategy"];
  outcome: "up" | "down" | null;
  tokenId: string | null;
  limitPrice: number | null;
  size: number | null;
  expectedRisk: number | null;
  reason: string;
  segment: string;
  payload: Record<string, unknown>;
};

const DEFAULT_GAMMA_URL = "https://gamma-api.polymarket.com";
const DEFAULT_CLOB_URL = "https://clob.polymarket.com";
const DEFAULT_PRICE_HISTORY_FIDELITY_SECONDS = 60;
const FIVE_MINUTES_SECONDS = 300;

export const DEFAULT_BACKTEST_PARAMS: BacktestParams = {
  strategy: "lottery_reprice",
  initialCapital: 100,
  maxRiskFraction: 0.1,
  entryMinPrice: 0.01,
  entryMaxPrice: 0.18,
  entryLimitOffset: 0,
  takeProfitMultiple: 2,
  stopLossFraction: 0.5,
  maxHoldSeconds: 90,
  forceExitBeforeEndSeconds: 10,
  minSecondsRemaining: 20,
  maxSecondsRemaining: 240,
  probabilityEdge: 0.08,
  assumedSpread: 0.01,
  decisionDelaySeconds: 1,
  allowHoldToSettlement: true,
  maxDailyLossFraction: 0.2,
  maxDrawdownFraction: 0.25,
  maxConsecutiveLosses: 6,
  maxOpenMarkets: 1,
  useKellySizing: false,
  kellyFraction: 0.25,
};

function envValue(name: string) {
  return process.env[name]?.trim() ?? "";
}

function isPrivateKey(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function gammaUrl() {
  return envValue("POLYMARKET_GAMMA_API_BASE") || DEFAULT_GAMMA_URL;
}

function clobUrl() {
  return envValue("POLYMARKET_API_BASE") || DEFAULT_CLOB_URL;
}

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = Number.NaN) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseEpochFromSlug(slug: string) {
  const match = slug.match(/-(\d{10})$/);
  return match ? Number(match[1]) : null;
}

function floorToFiveMinuteEpoch(timestampMs: number) {
  return Math.floor(timestampMs / 1000 / FIVE_MINUTES_SECONDS) * FIVE_MINUTES_SECONDS;
}

async function fetchJson<T>(url: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function buildPolymarketWalletClient() {
  const privateKey = envValue("POLYMARKET_PRIVATE_KEY") || envValue("POLYGON_TEST_PRIVATE_KEY");
  if (!isPrivateKey(privateKey)) throw new Error("POLYMARKET_PRIVATE_KEY or POLYGON_TEST_PRIVATE_KEY is required for authenticated CLOB trades.");
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return createWalletClient({
    account,
    transport: custom({
      request: async () => {
        throw new Error("CLOB L2 signing does not require Polygon RPC.");
      },
    }),
  });
}

function getPolymarketCreds() {
  const creds = {
    key: envValue("POLYMARKET_API_KEY"),
    secret: envValue("POLYMARKET_API_SECRET"),
    passphrase: envValue("POLYMARKET_API_PASSPHRASE"),
  } satisfies ApiKeyCreds;
  if (!creds.key || !creds.secret || !creds.passphrase) throw new Error("POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE are required for authenticated CLOB trades.");
  return creds;
}

function asStringHeaders(headers: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

async function fetchSignedClobJson<T>(endpoint: string, params: Record<string, string | number | undefined>, timeoutMs = 8000): Promise<T> {
  const url = new URL(endpoint, clobUrl());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const headers = await createL2Headers(buildPolymarketWalletClient(), getPolymarketCreds(), { method: "GET", requestPath: endpoint });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: asStringHeaders(headers) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMarket(event: JsonRecord): Btc5mMarket | null {
  const markets = Array.isArray(event.markets) ? event.markets.map(asRecord) : [];
  const market = markets[0];
  if (!market) return null;
  const outcomes = parseJsonArray(market.outcomes).map((value) => asString(value).toLowerCase());
  const tokenIds = parseJsonArray(market.clobTokenIds).map((value) => asString(value));
  const upIndex = outcomes.findIndex((outcome) => outcome === "up");
  const downIndex = outcomes.findIndex((outcome) => outcome === "down");
  const upTokenId = tokenIds[upIndex >= 0 ? upIndex : 0];
  const downTokenId = tokenIds[downIndex >= 0 ? downIndex : 1];
  const slug = asString(market.slug || event.slug);
  const startEpoch = parseEpochFromSlug(slug);
  const endTime = Date.parse(asString(market.endDate || event.endDate));
  if (!slug || !upTokenId || !downTokenId || !startEpoch || !Number.isFinite(endTime)) return null;
  const closed = event.closed === true || market.closed === true;
  const explicitWinner = asString(market.outcome || market.result || event.outcome || event.result).toLowerCase();
  const outcomePrices = parseJsonArray(market.outcomePrices).map((value) => asNumber(value));
  const resolvedPriceWinnerIndex = closed && outcomePrices.length >= 2 ? outcomePrices.findIndex((price) => price >= 0.99) : -1;
  const priceWinner = resolvedPriceWinnerIndex >= 0 ? outcomes[resolvedPriceWinnerIndex] : "";
  const winner = explicitWinner || priceWinner;
  const winningOutcome = winner === "up" || winner === "down" ? winner : null;
  return {
    slug,
    eventId: asString(event.id),
    marketId: asString(market.id),
    conditionId: asString(market.conditionId),
    question: asString(market.question || event.title || slug),
    startTime: startEpoch * 1000,
    endTime,
    upTokenId,
    downTokenId,
    closed,
    resolved: Boolean(closed || winningOutcome),
    winningOutcome,
    raw: event,
  };
}

export function buildRecentBtc5mSlugs(days = 7, now = Date.now()) {
  const endEpoch = floorToFiveMinuteEpoch(now);
  const startEpoch = endEpoch - Math.max(1, days) * 24 * 60 * 60;
  const slugs: string[] = [];
  for (let epoch = startEpoch; epoch <= endEpoch; epoch += FIVE_MINUTES_SECONDS) {
    slugs.push(`btc-updown-5m-${epoch}`);
  }
  return slugs;
}

export async function fetchBtc5mMarketBySlug(slug: string, timeoutMs = 6000): Promise<Btc5mMarket | null> {
  const payload = await fetchJson<unknown[]>(`${gammaUrl()}/events?slug=${encodeURIComponent(slug)}`, timeoutMs);
  const event = Array.isArray(payload) ? asRecord(payload[0]) : {};
  return Object.keys(event).length > 0 ? normalizeMarket(event) : null;
}

export async function discoverBtc5mDataSources() {
  const slug = buildRecentBtc5mSlugs(1).at(-1) ?? "";
  const market = slug ? await fetchBtc5mMarketBySlug(slug).catch(() => null) : null;
  const checks: Array<{ source: string; ready: boolean; detail: string }> = [
    { source: "gamma_events_by_slug", ready: Boolean(market), detail: market ? `Resolved ${market.slug}.` : "No current BTC 5m market resolved by slug." },
  ];
  if (market) {
    const bookUrl = `${clobUrl()}/book?token_id=${encodeURIComponent(market.upTokenId)}`;
    const historyUrl = `${clobUrl()}/prices-history?market=${encodeURIComponent(market.upTokenId)}&startTs=${Math.floor(market.startTime / 1000)}&endTs=${Math.floor(market.endTime / 1000)}&fidelity=${DEFAULT_PRICE_HISTORY_FIDELITY_SECONDS}`;
    const tradesUrl = `${clobUrl()}/data/trades?asset_id=${encodeURIComponent(market.upTokenId)}&next_cursor=MA==`;
    for (const [source, url] of [
      ["clob_book", bookUrl],
      ["clob_prices_history", historyUrl],
      ["clob_data_trades_public_probe", tradesUrl],
    ] as const) {
      try {
        await fetchJson<unknown>(url, 5000);
        checks.push({ source, ready: true, detail: `${source} endpoint returned JSON.` });
      } catch (error) {
        checks.push({ source, ready: false, detail: error instanceof Error ? error.message : `${source} probe failed.` });
      }
    }
  }
  try {
    await fetchJson<unknown>("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1", 5000);
    checks.push({ source: "binance_btcusdt_1m", ready: true, detail: "Binance 1m klines endpoint returned JSON." });
  } catch (error) {
    checks.push({ source: "binance_btcusdt_1m", ready: false, detail: error instanceof Error ? error.message : "Binance probe failed." });
  }
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    await fetchJson<unknown>(
      `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
      5000,
    );
    checks.push({ source: "coinbase_btcusd_1m", ready: true, detail: "Coinbase 1m candles endpoint returned JSON." });
  } catch (error) {
    checks.push({ source: "coinbase_btcusd_1m", ready: false, detail: error instanceof Error ? error.message : "Coinbase probe failed." });
  }
  return {
    checkedAt: Date.now(),
    market: market
      ? {
          slug: market.slug,
          question: market.question,
          startTime: market.startTime,
          endTime: market.endTime,
          upTokenId: market.upTokenId,
          downTokenId: market.downTokenId,
          closed: market.closed,
          resolved: market.resolved,
          winningOutcome: market.winningOutcome,
        }
      : null,
    checks,
  };
}

export async function upsertBtc5mMarket(market: Btc5mMarket) {
  await runDatabaseQuery(
    `insert into polymarket_btc5m_markets
      (slug, event_id, market_id, condition_id, question, start_time, end_time, up_token_id, down_token_id, closed, resolved, winning_outcome, raw_json, collected_at, updated_at)
     values ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0), to_timestamp($7 / 1000.0), $8, $9, $10, $11, $12, $13, now(), now())
     on conflict (slug) do update set
       event_id = excluded.event_id,
       market_id = excluded.market_id,
       condition_id = excluded.condition_id,
       question = excluded.question,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       up_token_id = excluded.up_token_id,
       down_token_id = excluded.down_token_id,
       closed = excluded.closed,
       resolved = excluded.resolved,
       winning_outcome = excluded.winning_outcome,
       raw_json = excluded.raw_json,
       updated_at = now()`,
    [
      market.slug,
      market.eventId,
      market.marketId,
      market.conditionId,
      market.question,
      market.startTime,
      market.endTime,
      market.upTokenId,
      market.downTokenId,
      market.closed,
      market.resolved,
      market.winningOutcome,
      JSON.stringify(market.raw),
    ],
  );
}

export async function collectRecentBtc5mMarkets(input: { days?: number; limit?: number; throttleMs?: number; timeoutMs?: number; onProgress?: (progress: { processed: number; total: number; stored: number; missing: number; errors: number }) => void } = {}) {
  const slugs = buildRecentBtc5mSlugs(input.days ?? 7).slice(-(input.limit ?? Number.MAX_SAFE_INTEGER));
  const result = { requested: slugs.length, stored: 0, missing: 0, errors: [] as string[] };
  for (let index = 0; index < slugs.length; index += 1) {
    const slug = slugs[index] ?? "";
    try {
      const market = await fetchBtc5mMarketBySlug(slug, input.timeoutMs ?? 2500);
      if (!market) {
        result.missing += 1;
      } else {
        await upsertBtc5mMarket(market);
        result.stored += 1;
      }
    } catch (error) {
      result.errors.push(`${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
    input.onProgress?.({ processed: index + 1, total: slugs.length, stored: result.stored, missing: result.missing, errors: result.errors.length });
    if (input.throttleMs) await sleep(input.throttleMs);
  }
  return result;
}

async function readMarketsForBacktest(days = 7, limit = 2500): Promise<Btc5mMarket[]> {
  const result = await runDatabaseQuery<{
    slug: string;
    event_id: string | null;
    market_id: string | null;
    condition_id: string | null;
    question: string;
    start_time: Date;
    end_time: Date;
    up_token_id: string;
    down_token_id: string;
    closed: boolean;
    resolved: boolean;
    winning_outcome: "up" | "down" | null;
    raw_json: JsonRecord;
  }>(
    `select slug, event_id, market_id, condition_id, question, start_time, end_time, up_token_id, down_token_id, closed, resolved, winning_outcome, raw_json
     from (
       select slug, event_id, market_id, condition_id, question, start_time, end_time, up_token_id, down_token_id, closed, resolved, winning_outcome, raw_json
       from polymarket_btc5m_markets
       where start_time >= now() - ($1::text)::interval
       order by start_time desc
       limit $2
     ) recent
     order by start_time asc`,
    [`${Math.max(1, days)} days`, Math.max(1, limit)],
  );
  return (result?.rows ?? []).map((row) => ({
    slug: row.slug,
    eventId: row.event_id ?? "",
    marketId: row.market_id ?? "",
    conditionId: row.condition_id ?? "",
    question: row.question,
    startTime: row.start_time.getTime(),
    endTime: row.end_time.getTime(),
    upTokenId: row.up_token_id,
    downTokenId: row.down_token_id,
    closed: row.closed,
    resolved: row.resolved,
    winningOutcome: row.winning_outcome,
    raw: row.raw_json ?? {},
  }));
}

async function fetchPriceHistory(market: Btc5mMarket, outcome: "up" | "down", fidelitySeconds = DEFAULT_PRICE_HISTORY_FIDELITY_SECONDS, timeoutMs = 3000): Promise<PricePoint[]> {
  const tokenId = outcome === "up" ? market.upTokenId : market.downTokenId;
  const url = `${clobUrl()}/prices-history?market=${encodeURIComponent(tokenId)}&startTs=${Math.floor(market.startTime / 1000)}&endTs=${Math.floor(market.endTime / 1000)}&fidelity=${fidelitySeconds}`;
  const payload = await fetchJson<unknown>(url, timeoutMs);
  const payloadRecord = asRecord(payload);
  const history: unknown[] = Array.isArray(payloadRecord.history) ? payloadRecord.history : Array.isArray(payload) ? payload : [];
  return history
    .map(asRecord)
    .map((point) => ({
      marketSlug: market.slug,
      tokenId,
      outcome,
      price: asNumber(point.p ?? point.price),
      time: asNumber(point.t ?? point.timestamp) * 1000,
      source: "clob_prices_history" as const,
    }))
    .filter((point) => Number.isFinite(point.price) && Number.isFinite(point.time));
}

export async function collectBtc5mPriceHistory(input: { days?: number; limitMarkets?: number; throttleMs?: number; fidelitySeconds?: number; timeoutMs?: number; onProgress?: (progress: { processed: number; total: number; points: number; errors: number }) => void } = {}) {
  const markets = await readMarketsForBacktest(input.days ?? 7, input.limitMarkets ?? 2500);
  const result = { markets: markets.length, points: 0, errors: [] as string[] };
  const total = markets.length * 2;
  let processed = 0;
  for (const market of markets) {
    for (const outcome of ["up", "down"] as const) {
      try {
        const points = await fetchPriceHistory(market, outcome, input.fidelitySeconds ?? DEFAULT_PRICE_HISTORY_FIDELITY_SECONDS, input.timeoutMs ?? 3000);
        for (const point of points) {
          await runDatabaseQuery(
            `insert into polymarket_btc5m_price_history
              (market_slug, token_id, outcome, price, point_time, fidelity_seconds, source, raw_json)
             values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, $7, $8)
             on conflict (market_slug, token_id, point_time, fidelity_seconds, source) do nothing`,
            [point.marketSlug, point.tokenId, point.outcome, point.price, point.time, input.fidelitySeconds ?? DEFAULT_PRICE_HISTORY_FIDELITY_SECONDS, point.source, JSON.stringify(point)],
          );
        }
        result.points += points.length;
      } catch (error) {
        result.errors.push(`${market.slug}/${outcome}: ${error instanceof Error ? error.message : String(error)}`);
      }
      processed += 1;
      input.onProgress?.({ processed, total, points: result.points, errors: result.errors.length });
      if (input.throttleMs) await sleep(input.throttleMs);
    }
  }
  return result;
}

export async function collectBtc5mTrades(input: { days?: number; limitMarkets?: number; throttleMs?: number; pagesPerToken?: number } = {}) {
  const markets = await readMarketsForBacktest(input.days ?? 7, input.limitMarkets ?? 2500);
  const result = { markets: markets.length, trades: 0, errors: [] as string[] };
  for (const market of markets) {
    for (const outcome of ["up", "down"] as const) {
      const tokenId = outcome === "up" ? market.upTokenId : market.downTokenId;
      let nextCursor = "MA==";
      for (let page = 0; page < Math.max(1, input.pagesPerToken ?? 2) && nextCursor !== ""; page += 1) {
        try {
          const payload = await fetchSignedClobJson<{ data?: unknown[]; next_cursor?: string }>("/data/trades", { asset_id: tokenId, next_cursor: nextCursor }, 8000);
          const trades = Array.isArray(payload.data) ? payload.data.map(asRecord) : [];
          for (const trade of trades) {
            const tradeTime = asNumber(trade.timestamp ?? trade.created_at ?? trade.time);
            const tradeTimeMs = tradeTime > 10_000_000_000 ? tradeTime : tradeTime * 1000;
            const price = asNumber(trade.price);
            if (!Number.isFinite(tradeTimeMs) || !Number.isFinite(price)) continue;
            await runDatabaseQuery(
              `insert into polymarket_btc5m_trades
                (trade_id, market_slug, token_id, outcome, price, size, side, trade_time, transaction_hash, source, raw_json)
               values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8 / 1000.0), $9, 'clob_data_trades', $10)
               on conflict do nothing`,
              [
                asString(trade.id || trade.trade_id),
                market.slug,
                tokenId,
                outcome,
                price,
                Number.isFinite(asNumber(trade.size)) ? asNumber(trade.size) : null,
                asString(trade.side || trade.taker_side || trade.trader_side),
                tradeTimeMs,
                asString(trade.transaction_hash || trade.transactionHash),
                JSON.stringify(trade),
              ],
            );
            result.trades += 1;
          }
          nextCursor = payload.next_cursor ?? "";
        } catch (error) {
          result.errors.push(`${market.slug}/${outcome}: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
        if (input.throttleMs) await sleep(input.throttleMs);
      }
    }
  }
  return result;
}

export async function collectCurrentOrderbookSnapshots() {
  const slugs = buildRecentBtc5mSlugs(0.02);
  const activeMarkets = (await Promise.all(slugs.slice(-3).map((slug) => fetchBtc5mMarketBySlug(slug).catch(() => null)))).filter(
    (market): market is Btc5mMarket => Boolean(market && market.startTime <= Date.now() && Date.now() < market.endTime),
  );
  let stored = 0;
  const errors: string[] = [];
  for (const market of activeMarkets) {
    await upsertBtc5mMarket(market);
    for (const outcome of ["up", "down"] as const) {
      const tokenId = outcome === "up" ? market.upTokenId : market.downTokenId;
      try {
        const payload = await fetchJson<unknown>(`${clobUrl()}/book?token_id=${encodeURIComponent(tokenId)}`, 5000);
        const record = asRecord(payload);
        const bids = Array.isArray(record.bids) ? record.bids.map(asRecord) : [];
        const asks = Array.isArray(record.asks) ? record.asks.map(asRecord) : [];
        const bestBid = bids.map((bid) => ({ price: asNumber(bid.price), size: asNumber(bid.size) })).filter((bid) => Number.isFinite(bid.price)).sort((a, b) => b.price - a.price)[0];
        const bestAsk = asks.map((ask) => ({ price: asNumber(ask.price), size: asNumber(ask.size) })).filter((ask) => Number.isFinite(ask.price)).sort((a, b) => a.price - b.price)[0];
        const now = Date.now();
        await runDatabaseQuery(
          `insert into polymarket_btc5m_orderbook_snapshots
            (market_slug, token_id, outcome, bid, ask, bid_size, ask_size, spread, snapshot_time, source, raw_json)
           values ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0), 'clob_book', $10)
           on conflict (market_slug, token_id, snapshot_time, source) do nothing`,
          [
            market.slug,
            tokenId,
            outcome,
            bestBid?.price ?? null,
            bestAsk?.price ?? null,
            bestBid?.size ?? null,
            bestAsk?.size ?? null,
            bestBid && bestAsk ? bestAsk.price - bestBid.price : null,
            now,
            JSON.stringify(payload),
          ],
        );
        stored += 1;
      } catch (error) {
        errors.push(`${market.slug}/${outcome}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { markets: activeMarkets.length, snapshots: stored, errors };
}

export async function collectLiveOrderbookSnapshots(input: {
  durationSeconds?: number;
  intervalMs?: number;
  maxSnapshots?: number;
  onProgress?: (progress: { iterations: number; snapshots: number; errors: number; elapsedSeconds: number }) => void;
  shouldStop?: () => boolean;
} = {}) {
  const startedAt = Date.now();
  const durationMs = Math.max(1, input.durationSeconds ?? 300) * 1000;
  const intervalMs = Math.max(250, input.intervalMs ?? 1000);
  const maxSnapshots = Math.max(1, input.maxSnapshots ?? Number.MAX_SAFE_INTEGER);
  const result = { iterations: 0, snapshots: 0, errors: [] as string[], startedAt, finishedAt: startedAt };

  while (Date.now() - startedAt < durationMs && result.snapshots < maxSnapshots && !input.shouldStop?.()) {
    const iterationStartedAt = Date.now();
    try {
      const snapshot = await collectCurrentOrderbookSnapshots();
      result.iterations += 1;
      result.snapshots += snapshot.snapshots;
      result.errors.push(...snapshot.errors);
    } catch (error) {
      result.iterations += 1;
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
    result.finishedAt = Date.now();
    input.onProgress?.({
      iterations: result.iterations,
      snapshots: result.snapshots,
      errors: result.errors.length,
      elapsedSeconds: (result.finishedAt - startedAt) / 1000,
    });
    const sleepMs = Math.max(0, intervalMs - (Date.now() - iterationStartedAt));
    if (sleepMs > 0) await sleep(sleepMs);
  }
  result.finishedAt = Date.now();
  return {
    ...result,
    elapsedSeconds: (result.finishedAt - result.startedAt) / 1000,
  };
}

export async function collectBinanceBtcOneMinute(input: { days?: number; throttleMs?: number } = {}) {
  const end = Date.now();
  let start = end - Math.max(1, input.days ?? 7) * 24 * 60 * 60 * 1000;
  let stored = 0;
  const errors: string[] = [];
  while (start < end) {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=${start}&endTime=${end}&limit=1000`;
    try {
      const rows = await fetchJson<unknown[]>(url, 8000);
      if (rows.length === 0) break;
      for (const rawRow of rows) {
        const row = Array.isArray(rawRow) ? rawRow : [];
        const openTime = asNumber(row[0]);
        const close = asNumber(row[4]);
        if (!Number.isFinite(openTime) || !Number.isFinite(close)) continue;
        await runDatabaseQuery(
          `insert into btc_price_ticks (source, symbol, price, source_timestamp, raw_json)
           values ('binance_1m_close', 'BTC/USDT', $1, to_timestamp($2 / 1000.0), $3)
           on conflict (source, symbol, source_timestamp) do nothing`,
          [close, openTime, JSON.stringify(row)],
        );
        stored += 1;
      }
      start = asNumber((rows.at(-1) as unknown[] | undefined)?.[0], start) + 60_000;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      break;
    }
    if (input.throttleMs) await sleep(input.throttleMs);
  }
  return { stored, errors };
}

export async function collectCoinbaseBtcOneMinute(input: { days?: number; throttleMs?: number } = {}) {
  const end = Date.now();
  let start = end - Math.max(1, input.days ?? 7) * 24 * 60 * 60 * 1000;
  let stored = 0;
  const errors: string[] = [];
  while (start < end) {
    const batchEnd = Math.min(end, start + 300 * 60_000);
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${encodeURIComponent(new Date(start).toISOString())}&end=${encodeURIComponent(new Date(batchEnd).toISOString())}`;
    try {
      const rows = await fetchJson<unknown[]>(url, 8000);
      if (rows.length === 0) {
        start = batchEnd + 60_000;
        continue;
      }
      for (const rawRow of rows) {
        const row = Array.isArray(rawRow) ? rawRow : [];
        const timeSeconds = asNumber(row[0]);
        const close = asNumber(row[4]);
        if (!Number.isFinite(timeSeconds) || !Number.isFinite(close)) continue;
        await runDatabaseQuery(
          `insert into btc_price_ticks (source, symbol, price, source_timestamp, raw_json)
           values ('coinbase_1m_close', 'BTC/USD', $1, to_timestamp($2), $3)
           on conflict (source, symbol, source_timestamp) do nothing`,
          [close, timeSeconds, JSON.stringify(row)],
        );
        stored += 1;
      }
      start = batchEnd + 60_000;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      break;
    }
    if (input.throttleMs) await sleep(input.throttleMs);
  }
  return { stored, errors };
}

export async function collectAuxiliaryBtcOneMinute(input: { days?: number; throttleMs?: number } = {}) {
  const binance = await collectBinanceBtcOneMinute(input);
  if (binance.stored > 0) return { primary: "binance_1m_close", binance, coinbase: null };
  const coinbase = await collectCoinbaseBtcOneMinute(input);
  return { primary: coinbase.stored > 0 ? "coinbase_1m_close" : "none", binance, coinbase };
}

export async function getBtc5mResearchCoverage(input: { days?: number } = {}) {
  const days = Math.max(1, input.days ?? 7);
  const summary = await runDatabaseQuery<{
    markets: string;
    resolved_markets: string;
    price_points: string;
    orderbook_snapshots: string;
    trades: string;
    btc_ticks: string;
  }>(
    `with recent_markets as (
       select slug
       from polymarket_btc5m_markets
       where start_time >= now() - ($1::text)::interval
     )
     select
       (select count(*) from recent_markets) as markets,
       (select count(*) from polymarket_btc5m_markets where slug in (select slug from recent_markets) and winning_outcome is not null) as resolved_markets,
       (select count(*) from polymarket_btc5m_price_history where market_slug in (select slug from recent_markets)) as price_points,
       (select count(*) from polymarket_btc5m_orderbook_snapshots where market_slug in (select slug from recent_markets)) as orderbook_snapshots,
       (select count(*) from polymarket_btc5m_trades where market_slug in (select slug from recent_markets)) as trades,
       (select count(*) from btc_price_ticks where source_timestamp >= now() - ($1::text)::interval) as btc_ticks`,
    [`${days} days`],
  );
  const segmentRows = await runDatabaseQuery<{ segment: string; snapshots: string }>(
    `select
       case
         when extract(dow from snapshot_time at time zone 'Asia/Shanghai') in (0, 6) then 'weekend' else 'weekday'
       end || '_' ||
       case
         when extract(hour from snapshot_time at time zone 'Asia/Shanghai') >= 8
          and extract(hour from snapshot_time at time zone 'Asia/Shanghai') < 18 then 'beijing_day'
         else 'beijing_night'
       end as segment,
       count(*) as snapshots
     from polymarket_btc5m_orderbook_snapshots
     where snapshot_time >= now() - ($1::text)::interval
     group by 1
     order by 1`,
    [`${days} days`],
  );
  const row = summary?.rows[0];
  const markets = Number(row?.markets ?? 0);
  const pricePoints = Number(row?.price_points ?? 0);
  const snapshots = Number(row?.orderbook_snapshots ?? 0);
  const trades = Number(row?.trades ?? 0);
  const executablePoints = snapshots + trades;
  const minimumExecutablePoints = Math.max(500, markets * 6);
  return {
    days,
    markets,
    resolvedMarkets: Number(row?.resolved_markets ?? 0),
    pricePoints,
    orderbookSnapshots: snapshots,
    trades,
    btcTicks: Number(row?.btc_ticks ?? 0),
    executablePoints,
    minimumExecutablePoints,
    readyForGeneticSearch: executablePoints >= minimumExecutablePoints,
    segmentSnapshots: Object.fromEntries((segmentRows?.rows ?? []).map((segment) => [segment.segment, Number(segment.snapshots)])),
    nextAction:
      executablePoints >= minimumExecutablePoints
        ? "Run btc5m:research genetic with a larger population and validation split."
        : "Continue collect-orderbook-live until executable orderbook/trade evidence is dense enough for limit-order fills.",
  };
}

export async function evaluateLatestBtc5mPaperSignal(input: { params?: Partial<BacktestParams>; persist?: boolean } = {}): Promise<PaperSignalReport> {
  const params = { ...DEFAULT_BACKTEST_PARAMS, ...(input.params ?? {}) };
  const now = Date.now();
  const markets = await readMarketsForBacktest(1, 12);
  let activeMarket: Btc5mMarket | null = markets
    .filter((market) => market.startTime <= now && now < market.endTime)
    .sort((a, b) => b.startTime - a.startTime)[0];
  if (!activeMarket) {
    const slug = `btc-updown-5m-${floorToFiveMinuteEpoch(now)}`;
    activeMarket = await fetchBtc5mMarketBySlug(slug, 2500).catch(() => null);
    if (activeMarket) await upsertBtc5mMarket(activeMarket);
  }
  const signalId = `btc5m-paper-${now}`;
  if (!activeMarket) {
    return {
      signalId,
      marketSlug: null,
      decision: "blocked",
      strategy: params.strategy,
      outcome: null,
      tokenId: null,
      limitPrice: null,
      size: null,
      expectedRisk: null,
      reason: "No active BTC 5m market with stored metadata.",
      segment: beijingSegment(now),
      payload: {},
    };
  }

  const data = await readPricePoints(1, 12);
  const points = data.points.filter((point) => point.marketSlug === activeMarket.slug);
  const up = bestBookPrice(points, "up");
  const down = bestBookPrice(points, "down");
  const candidate = chooseOutcome(params, up, down);
  const secondsRemaining = (activeMarket.endTime - now) / 1000;
  let report: PaperSignalReport;
  if (!candidate || secondsRemaining < params.minSecondsRemaining || secondsRemaining > params.maxSecondsRemaining) {
    report = {
      signalId,
      marketSlug: activeMarket.slug,
      decision: "no_signal",
      strategy: params.strategy,
      outcome: null,
      tokenId: null,
      limitPrice: null,
      size: null,
      expectedRisk: null,
      reason: candidate ? "Candidate exists but time window guard blocked it." : "No strategy candidate from latest UP/DOWN book points.",
      segment: beijingSegment(now),
      payload: { secondsRemaining, up, down, params },
    };
  } else {
    const ask = priceToAsk(candidate.price, params, candidate.source);
    const limitPrice = Math.max(0.01, Math.min(0.99, ask - params.entryLimitOffset));
    const riskBudget = params.initialCapital * params.maxRiskFraction;
    const size = Math.floor((riskBudget / limitPrice) * 100) / 100;
    const enter = limitPrice >= params.entryMinPrice && limitPrice <= params.entryMaxPrice;
    report = {
      signalId,
      marketSlug: activeMarket.slug,
      decision: enter ? "would_enter" : "no_signal",
      strategy: params.strategy,
      outcome: candidate.outcome,
      tokenId: candidate.tokenId,
      limitPrice,
      size,
      expectedRisk: limitPrice * size,
      reason: enter ? "Limit-entry criteria passed in paper mode." : "Candidate limit price is outside entry bounds.",
      segment: beijingSegment(now),
      payload: { secondsRemaining, up, down, candidate, params },
    };
  }
  if (input.persist) await persistPaperSignal(report);
  return report;
}

export async function persistPaperSignal(report: PaperSignalReport) {
  await runDatabaseQuery(
    `insert into btc5m_paper_signals
      (signal_id, market_slug, token_id, outcome, decision, strategy, limit_price, size, expected_risk, reason, segment, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (signal_id) do nothing`,
    [
      report.signalId,
      report.marketSlug ?? "none",
      report.tokenId,
      report.outcome,
      report.decision,
      report.strategy,
      report.limitPrice,
      report.size,
      report.expectedRisk,
      report.reason,
      report.segment,
      JSON.stringify(report.payload),
    ],
  );
}

async function readPricePoints(days: number, limitMarkets: number): Promise<{ markets: Btc5mMarket[]; points: PricePoint[] }> {
  const markets = await readMarketsForBacktest(days, limitMarkets);
  if (markets.length === 0) return { markets, points: [] };
  const slugs = markets.map((market) => market.slug);
  const priceRows = await runDatabaseQuery<{
    market_slug: string;
    token_id: string;
    outcome: "up" | "down";
    price: string;
    point_time: Date;
    source: "clob_prices_history";
  }>(
    `select market_slug, token_id, outcome, price, point_time, source
     from polymarket_btc5m_price_history
     where market_slug = any($1)
     order by market_slug, point_time asc`,
    [slugs],
  );
  const bookRows = await runDatabaseQuery<{
    market_slug: string;
    token_id: string;
    outcome: "up" | "down";
    bid: string | null;
    ask: string | null;
    snapshot_time: Date;
  }>(
    `select market_slug, token_id, outcome, bid, ask, snapshot_time
     from polymarket_btc5m_orderbook_snapshots
     where market_slug = any($1)
     order by market_slug, snapshot_time asc`,
    [slugs],
  );
  const pricePoints = (priceRows?.rows ?? []).map((row) => ({
    marketSlug: row.market_slug,
    tokenId: row.token_id,
    outcome: row.outcome,
    price: Number(row.price),
    time: row.point_time.getTime(),
    source: row.source,
  }));
  const bookPoints = (bookRows?.rows ?? []).flatMap((row) => {
    const points: PricePoint[] = [];
    if (row.ask !== null) points.push({ marketSlug: row.market_slug, tokenId: row.token_id, outcome: row.outcome, price: Number(row.ask), time: row.snapshot_time.getTime(), source: "orderbook_snapshot" });
    if (row.bid !== null) points.push({ marketSlug: row.market_slug, tokenId: row.token_id, outcome: row.outcome, price: Number(row.bid), time: row.snapshot_time.getTime(), source: "orderbook_snapshot" });
    return points;
  });
  return { markets, points: [...pricePoints, ...bookPoints].sort((a, b) => a.time - b.time) };
}

function priceToAsk(price: number, params: BacktestParams, source: PricePoint["source"]) {
  if (source === "orderbook_snapshot") return price;
  return Math.min(0.99, price + params.assumedSpread / 2);
}

function priceToBid(price: number, params: BacktestParams, source: PricePoint["source"]) {
  if (source === "orderbook_snapshot") return price;
  return Math.max(0.01, price - params.assumedSpread / 2);
}

function bestBookPrice(points: PricePoint[], outcome: "up" | "down") {
  return points
    .filter((point) => point.outcome === outcome)
    .sort((a, b) => b.time - a.time)[0];
}

function beijingSegment(timestamp: number) {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  const dayType = day === 0 || day === 6 ? "weekend" : "weekday";
  const session = hour >= 8 && hour < 18 ? "beijing_day" : "beijing_night";
  return `${dayType}_${session}`;
}

function utcDayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function estimatedKellyFraction(entryPrice: number, exitTarget: number, winRateEstimate: number) {
  const loss = Math.max(0.000001, entryPrice);
  const gain = Math.max(0.000001, exitTarget - entryPrice);
  const b = gain / loss;
  const q = 1 - winRateEstimate;
  return Math.max(0, Math.min(1, (b * winRateEstimate - q) / b));
}

function chooseOutcome(params: BacktestParams, up: PricePoint | undefined, down: PricePoint | undefined) {
  if (!up || !down) return null;
  if (params.strategy === "lottery_reprice") return up.price <= down.price ? up : down;
  const probabilityUp = Math.min(0.99, Math.max(0.01, 1 - up.price));
  const upEdge = probabilityUp - up.price;
  const downEdge = (1 - probabilityUp) - down.price;
  if (upEdge >= params.probabilityEdge && upEdge >= downEdge) return up;
  if (downEdge >= params.probabilityEdge) return down;
  return null;
}

export async function runBtc5mBacktest(input: { days?: number; limitMarkets?: number; params?: Partial<BacktestParams>; persist?: boolean } = {}): Promise<BacktestReport> {
  const params = { ...DEFAULT_BACKTEST_PARAMS, ...(input.params ?? {}) };
  const { markets, points } = await readPricePoints(input.days ?? 7, input.limitMarkets ?? 2500);
  const report = runBtc5mBacktestFromData({ markets, points, params });
  if (input.persist) await persistBacktestReport(report);
  return report;
}

export function runBtc5mBacktestFromData(input: { markets: Btc5mMarket[]; points: PricePoint[]; params?: Partial<BacktestParams> }): BacktestReport {
  const params = { ...DEFAULT_BACKTEST_PARAMS, ...(input.params ?? {}) };
  const { markets, points } = input;
  const pointsByMarket = new Map<string, PricePoint[]>();
  const sourceBreakdown: Record<string, number> = {};
  for (const point of points) {
    const list = pointsByMarket.get(point.marketSlug) ?? [];
    list.push(point);
    pointsByMarket.set(point.marketSlug, list);
    sourceBreakdown[point.source] = (sourceBreakdown[point.source] ?? 0) + 1;
  }

  let capital = params.initialCapital;
  let peak = capital;
  let maxDrawdown = 0;
  let consecutiveLosses = 0;
  let stopped = false;
  const dailyPnl = new Map<string, number>();
  const trades: BacktestTrade[] = [];

  for (const market of markets) {
    if (stopped) break;
    if (!market.winningOutcome) continue;
    const dayKey = utcDayKey(market.startTime);
    const dayLossLimit = params.initialCapital * params.maxDailyLossFraction;
    if ((dailyPnl.get(dayKey) ?? 0) <= -dayLossLimit) continue;
    const marketPoints = pointsByMarket.get(market.slug) ?? [];
    const upPoints = marketPoints.filter((point) => point.outcome === "up");
    const downPoints = marketPoints.filter((point) => point.outcome === "down");
    const timeline = [...new Set(marketPoints.map((point) => point.time))].sort((a, b) => a - b);
    if (timeline.length === 0) continue;

    for (const time of timeline) {
      const secondsRemaining = (market.endTime - time) / 1000;
      if (secondsRemaining < params.minSecondsRemaining || secondsRemaining > params.maxSecondsRemaining) continue;
      const delayedTime = time + params.decisionDelaySeconds * 1000;
      const up = upPoints.filter((point) => point.time <= delayedTime).at(-1);
      const down = downPoints.filter((point) => point.time <= delayedTime).at(-1);
      const candidate = chooseOutcome(params, up, down);
      if (!candidate) continue;
      const ask = priceToAsk(candidate.price, params, candidate.source);
      const entryLimit = Math.max(0.01, Math.min(0.99, ask - params.entryLimitOffset));
      if (entryLimit < params.entryMinPrice || entryLimit > params.entryMaxPrice) continue;
      const risk = capital * params.maxRiskFraction;
      const target = Math.min(0.99, entryLimit * params.takeProfitMultiple);
      const kellyRisk = params.useKellySizing
        ? capital * estimatedKellyFraction(entryLimit, target, 0.5 + Math.min(0.2, params.probabilityEdge)) * params.kellyFraction
        : risk;
      const effectiveRisk = Math.min(risk, Math.max(0, kellyRisk));
      const size = Math.floor((effectiveRisk / entryLimit) * 100) / 100;
      if (size <= 0) continue;
      const entryCost = entryLimit * size;
      capital -= entryCost;

      const exitPoints = (candidate.outcome === "up" ? upPoints : downPoints).filter((point) => point.time > delayedTime);
      const stop = Math.max(0.01, entryLimit * params.stopLossFraction);
      let exitTime = market.endTime;
      let exitPrice = market.winningOutcome === candidate.outcome ? 1 : 0;
      let exitLimit = target;
      let reason = "settlement";
      let status: BacktestTrade["status"] = "settled";
      for (const point of exitPoints) {
        const heldSeconds = (point.time - delayedTime) / 1000;
        const remaining = (market.endTime - point.time) / 1000;
        const bid = priceToBid(point.price, params, point.source);
        if (bid >= target) {
          exitTime = point.time;
          exitPrice = target;
          exitLimit = target;
          reason = "take_profit_limit";
          status = "sold";
          break;
        }
        if (bid <= stop && heldSeconds >= 5) {
          exitTime = point.time;
          exitPrice = Math.max(0.01, stop);
          exitLimit = Math.max(0.01, stop);
          reason = "stop_loss_limit";
          status = "sold";
          break;
        }
        if (heldSeconds >= params.maxHoldSeconds || remaining <= params.forceExitBeforeEndSeconds) {
          exitTime = point.time;
          exitPrice = bid;
          exitLimit = bid;
          reason = "time_exit_limit";
          status = "sold";
          break;
        }
      }
      if (!params.allowHoldToSettlement && status !== "sold") {
        exitPrice = 0;
        reason = "exit_unfilled_no_settlement";
      }
      const proceeds = exitPrice * size;
      capital += proceeds;
      const pnl = proceeds - entryCost;
      dailyPnl.set(dayKey, (dailyPnl.get(dayKey) ?? 0) + pnl);
      consecutiveLosses = pnl < 0 ? consecutiveLosses + 1 : 0;
      trades.push({
        marketSlug: market.slug,
        tokenId: candidate.tokenId,
        outcome: candidate.outcome,
        entryTime: delayedTime,
        entryLimit,
        entryPrice: entryLimit,
        size,
        exitTime,
        exitLimit,
        exitPrice,
        status,
        pnl,
        reason,
      });
      peak = Math.max(peak, capital);
      maxDrawdown = Math.max(maxDrawdown, peak - capital);
      if (maxDrawdown >= params.initialCapital * params.maxDrawdownFraction) stopped = true;
      if (consecutiveLosses >= params.maxConsecutiveLosses) stopped = true;
      break;
    }
  }

  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const segments = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const trade of trades) {
    const key = beijingSegment(trade.entryTime);
    const segment = segments.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
    segment.trades += 1;
    segment.wins += trade.pnl > 0 ? 1 : 0;
    segment.pnl += trade.pnl;
    segments.set(key, segment);
  }
  const segmentBreakdown = Object.fromEntries(
    [...segments.entries()].map(([key, value]) => [
      key,
      {
        trades: value.trades,
        pnl: value.pnl,
        winRate: value.trades ? value.wins / value.trades : 0,
      },
    ]),
  );
  const runId = `btc5m-${params.strategy}-${Date.now()}`;
  const report: BacktestReport = {
    runId,
    strategy: params.strategy,
    parameters: params,
    initialCapital: params.initialCapital,
    finalCapital: capital,
    totalPnl: capital - params.initialCapital,
    maxDrawdown,
    winRate: trades.length ? wins / trades.length : 0,
    tradeCount: trades.length,
    filledEntryCount: trades.length,
    sourceBreakdown,
    segmentBreakdown,
    trades,
    notes: [
      "All entries and exits are modeled as limit orders.",
      "Historical CLOB price-history points are used as a conservative proxy when full orderbook snapshots are unavailable.",
      "Live orderbook snapshots, when present, are included and counted separately in sourceBreakdown.",
      "Performance is segmented by Beijing day/night and weekday/weekend where trades exist.",
      "Trader-style hard risk limits cap sizing before any optional fractional Kelly sizing is applied.",
    ],
  };
  return report;
}

export async function persistBacktestReport(report: BacktestReport) {
  await runDatabaseQuery(
    `insert into btc5m_backtest_runs
      (run_id, strategy, parameters, initial_capital, final_capital, total_pnl, max_drawdown, win_rate, trade_count, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (run_id) do nothing`,
    [
      report.runId,
      report.strategy,
      JSON.stringify(report.parameters),
      report.initialCapital,
      report.finalCapital,
      report.totalPnl,
      report.maxDrawdown,
      report.winRate,
      report.tradeCount,
      JSON.stringify(report),
    ],
  );
  for (const trade of report.trades) {
    await runDatabaseQuery(
      `insert into btc5m_backtest_orders
        (run_id, market_slug, token_id, outcome, action, limit_price, requested_size, filled_size, status, submit_time, fill_time, realized_pnl, payload)
       values ($1, $2, $3, $4, 'limit_buy', $5, $6, $6, $7, to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0), $10, $11)`,
      [
        report.runId,
        trade.marketSlug,
        trade.tokenId,
        trade.outcome,
        trade.entryLimit,
        trade.size,
        trade.status,
        trade.entryTime,
        trade.exitTime,
        trade.pnl,
        JSON.stringify(trade),
      ],
    );
  }
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function mutateParams(parent: BacktestParams): BacktestParams {
  return {
    ...parent,
    entryMaxPrice: Math.max(0.03, Math.min(0.35, parent.entryMaxPrice + randomBetween(-0.03, 0.03))),
    takeProfitMultiple: Math.max(1.2, Math.min(8, parent.takeProfitMultiple + randomBetween(-0.5, 0.5))),
    stopLossFraction: Math.max(0.1, Math.min(0.95, parent.stopLossFraction + randomBetween(-0.08, 0.08))),
    maxHoldSeconds: Math.max(10, Math.min(240, Math.round(parent.maxHoldSeconds + randomBetween(-20, 20)))),
    minSecondsRemaining: Math.max(5, Math.min(120, Math.round(parent.minSecondsRemaining + randomBetween(-10, 10)))),
    maxSecondsRemaining: Math.max(30, Math.min(290, Math.round(parent.maxSecondsRemaining + randomBetween(-20, 20)))),
    probabilityEdge: Math.max(0, Math.min(0.4, parent.probabilityEdge + randomBetween(-0.03, 0.03))),
    assumedSpread: Math.max(0, Math.min(0.08, parent.assumedSpread + randomBetween(-0.005, 0.005))),
    decisionDelaySeconds: Math.max(0, Math.min(5, Math.round(parent.decisionDelaySeconds + randomBetween(-1, 1)))),
    kellyFraction: Math.max(0.05, Math.min(0.5, parent.kellyFraction + randomBetween(-0.05, 0.05))),
    useKellySizing: Math.random() > 0.7 ? !parent.useKellySizing : parent.useKellySizing,
  };
}

function scoreReport(report: BacktestReport) {
  if (report.tradeCount < 5) return -1_000_000 + report.totalPnl;
  return report.totalPnl - report.maxDrawdown * 0.35 + report.winRate * 2;
}

function splitMarketsForValidation(markets: Btc5mMarket[], validationFraction: number, points: PricePoint[] = []) {
  const pointSlugs = new Set(points.map((point) => point.marketSlug));
  const marketsWithPoints = markets.filter((market) => pointSlugs.has(market.slug));
  const sorted = (marketsWithPoints.length >= 2 ? marketsWithPoints : markets).sort((a, b) => a.startTime - b.startTime);
  const validationCount = Math.max(1, Math.floor(sorted.length * Math.max(0.05, Math.min(0.5, validationFraction))));
  const splitIndex = Math.max(1, sorted.length - validationCount);
  return {
    trainMarkets: sorted.slice(0, splitIndex),
    validationMarkets: sorted.slice(splitIndex),
  };
}

function filterPointsForMarkets(points: PricePoint[], markets: Btc5mMarket[]) {
  const slugs = new Set(markets.map((market) => market.slug));
  return points.filter((point) => slugs.has(point.marketSlug));
}

export async function runBtc5mGeneticSearch(input: { days?: number; limitMarkets?: number; generations?: number; population?: number; validationFraction?: number; persistBest?: boolean } = {}) {
  const generations = Math.max(1, Math.min(50, input.generations ?? 6));
  const populationSize = Math.max(4, Math.min(60, input.population ?? 12));
  const dataset = await readPricePoints(input.days ?? 7, input.limitMarkets ?? 2500);
  const { trainMarkets, validationMarkets } = splitMarketsForValidation(dataset.markets, input.validationFraction ?? 2 / 7, dataset.points);
  const trainPoints = filterPointsForMarkets(dataset.points, trainMarkets);
  const validationPoints = filterPointsForMarkets(dataset.points, validationMarkets);
  let population = Array.from({ length: populationSize }, (_, index): BacktestParams => ({
    ...DEFAULT_BACKTEST_PARAMS,
    strategy: index % 2 === 0 ? "lottery_reprice" : "probability_cone",
    entryMaxPrice: randomBetween(0.05, 0.25),
    takeProfitMultiple: randomBetween(1.4, 5),
    stopLossFraction: randomBetween(0.25, 0.8),
    maxHoldSeconds: Math.round(randomBetween(20, 160)),
    minSecondsRemaining: Math.round(randomBetween(10, 80)),
    maxSecondsRemaining: Math.round(randomBetween(120, 280)),
    probabilityEdge: randomBetween(0.02, 0.2),
    decisionDelaySeconds: Math.round(randomBetween(0, 5)),
    useKellySizing: index % 3 === 0,
    kellyFraction: randomBetween(0.1, 0.35),
  }));
  const history: Array<{ generation: number; bestScore: number; best: BacktestReport }> = [];
  for (let generation = 0; generation < generations; generation += 1) {
    const reports = [];
    for (const params of population) {
      reports.push(runBtc5mBacktestFromData({ markets: trainMarkets, points: trainPoints, params }));
    }
    const ranked = reports.map((report) => ({ report, score: scoreReport(report) })).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (best) history.push({ generation, bestScore: best.score, best: best.report });
    const survivors = ranked.slice(0, Math.max(2, Math.ceil(populationSize / 4))).map((item) => item.report.parameters);
    population = [];
    while (population.length < populationSize) {
      const parent = survivors[population.length % survivors.length] ?? DEFAULT_BACKTEST_PARAMS;
      population.push(mutateParams(parent));
    }
  }
  const bestTrain = history.map((item) => item.best).sort((a, b) => scoreReport(b) - scoreReport(a))[0] ?? runBtc5mBacktestFromData({ markets: trainMarkets, points: trainPoints });
  const validation = runBtc5mBacktestFromData({ markets: validationMarkets, points: validationPoints, params: bestTrain.parameters });
  if (input.persistBest) await persistBacktestReport({ ...validation, runId: `${validation.runId}-validation`, strategy: `${validation.strategy}_validation` });
  return {
    generations,
    population: populationSize,
    validationFraction: input.validationFraction ?? 2 / 7,
    dataset: {
      markets: dataset.markets.length,
      points: dataset.points.length,
      trainMarkets: trainMarkets.length,
      trainPoints: trainPoints.length,
      validationMarkets: validationMarkets.length,
      validationPoints: validationPoints.length,
    },
    bestTrain,
    validation,
    accepted: validation.tradeCount >= 5 && validation.totalPnl > 0 && validation.maxDrawdown <= validation.initialCapital * validation.parameters.maxDrawdownFraction,
    history: history.map((item) => ({
      generation: item.generation,
      bestScore: item.bestScore,
      totalPnl: item.best.totalPnl,
      maxDrawdown: item.best.maxDrawdown,
      tradeCount: item.best.tradeCount,
      params: item.best.parameters,
    })),
  };
}
