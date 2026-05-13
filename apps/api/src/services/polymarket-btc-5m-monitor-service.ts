import { clamp, normalCdf } from "@vol-arb/core";

type JsonRecord = Record<string, unknown>;

type MarketWindow = {
  eventId: string;
  marketId: string;
  conditionId: string;
  question: string;
  slug: string;
  startTime: number;
  endTime: number;
  upTokenId: string;
  downTokenId: string;
};

type OrderbookSide = {
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  bidSize: number | null;
  askSize: number | null;
};

type ChainlinkTick = {
  price: number;
  timestamp: number;
};

type FastReferencePrice = {
  source: string;
  price: number | null;
  timestamp: number | null;
  ageSeconds: number | null;
  basisToChainlink: number | null;
  error: string | null;
};

export type BtcFiveMinuteMonitor = {
  mode: "read_only";
  status: "healthy" | "warning" | "critical";
  updatedAt: number;
  rtds: {
    connected: boolean;
    topic: "crypto_prices_chainlink";
    symbol: "btc/usd";
    price: number | null;
    timestamp: number | null;
    ageSeconds: number | null;
    tickCount: number;
    error: string | null;
  };
  market: MarketWindow | null;
  orderbook: {
    up: OrderbookSide;
    down: OrderbookSide;
  };
  fastReference: FastReferencePrice;
  model: {
    spot: number | null;
    openPrice: number | null;
    openPriceSource: "chainlink_window_start" | "chainlink_window_observed" | "current_tick_fallback" | "unavailable";
    secondsRemaining: number | null;
    annualizedVol: number | null;
    sampleCount: number;
    probabilityUp: number | null;
    probabilityDown: number | null;
    edgeUp: number | null;
    edgeDown: number | null;
    cone: {
      lower68: number | null;
      upper68: number | null;
      lower95: number | null;
      upper95: number | null;
      expectedMove68: number | null;
      expectedMove95: number | null;
    };
    minEdge: number;
    decision: "strong_up" | "strong_down" | "lean_up" | "lean_down" | "no_edge" | "blocked";
    reasons: string[];
    warnings: string[];
  };
  notes: string[];
};

type MonitorOptions = {
  now?: () => number;
  gammaUrl?: string;
  clobUrl?: string;
  rtdsUrl?: string;
  minEdge?: number;
  fetchChainlinkTicks?: () => Promise<{ ticks: ChainlinkTick[]; connected: boolean; error: string | null }>;
  fetchFastReference?: () => Promise<FastReferencePrice>;
};

const DEFAULT_MIN_EDGE = 0.01;
const DEFAULT_LEAN_EDGE = 0;
const DEFAULT_ANNUAL_VOL = 0.65;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const chainlinkTicks: ChainlinkTick[] = [];
let lastMonitor: BtcFiveMinuteMonitor | null = null;

function envValue(name: string): string | undefined {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return maybeProcess?.env?.[name];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = Number.NaN) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
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

function parseEpochFromSlug(slug: string) {
  const match = slug.match(/-(\d{10})$/);
  return match ? Number(match[1]) * 1000 : null;
}

function normalizeMarket(event: JsonRecord, now: number): MarketWindow | null {
  const markets = Array.isArray(event.markets) ? event.markets.filter(isRecord) : [];
  const market = markets[0];
  if (!market) return null;
  const outcomes = parseJsonArray(market.outcomes).map((value) => asString(value).toLowerCase());
  const tokenIds = parseJsonArray(market.clobTokenIds).map((value) => asString(value));
  const upIndex = outcomes.findIndex((outcome) => outcome === "up");
  const downIndex = outcomes.findIndex((outcome) => outcome === "down");
  const upTokenId = tokenIds[upIndex >= 0 ? upIndex : 0];
  const downTokenId = tokenIds[downIndex >= 0 ? downIndex : 1];
  const slug = asString(market.slug || event.slug);
  const startTime = parseEpochFromSlug(slug);
  const endTime = Date.parse(asString(market.endDate || event.endDate));
  const closed = market.closed === true || event.closed === true;
  if (!upTokenId || !downTokenId || !startTime || !Number.isFinite(endTime) || closed || endTime <= now) return null;
  return {
    eventId: asString(event.id),
    marketId: asString(market.id),
    conditionId: asString(market.conditionId),
    question: asString(market.question || event.title),
    slug,
    startTime,
    endTime,
    upTokenId,
    downTokenId,
  };
}

async function discoverBtcFiveMinuteMarket(gammaUrl: string, now: number): Promise<MarketWindow | null> {
  const base = Math.floor(now / 1000 / 300) * 300;
  const fetchWindow = async (epoch: number) => {
    try {
      const payload = await fetchJson<unknown[]>(`${gammaUrl}/events?slug=btc-updown-5m-${epoch}`, 2500);
      const event = Array.isArray(payload) && isRecord(payload[0]) ? payload[0] : null;
      return event ? normalizeMarket(event, now) : null;
    } catch {
      return null;
    }
  };
  const current = await fetchWindow(base);
  if (current && current.startTime <= now && now < current.endTime) return current;

  const candidates = [base - 300, base + 300, base - 600, base + 600, base - 900, base + 900];
  const windows = await Promise.all(
    candidates.map((epoch) => fetchWindow(epoch)),
  );
  const valid = windows.filter((market): market is MarketWindow => market !== null);
  const active = valid
    .filter((market) => market.startTime <= now && now < market.endTime)
    .sort((a, b) => b.startTime - a.startTime)[0];
  if (active) return active;
  return valid
    .filter((market) => market.startTime > now)
    .sort((a, b) => a.startTime - b.startTime)[0] ?? null;
}

function extractTicksFromMessage(raw: string): ChainlinkTick[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const payload = isRecord(parsed.payload) ? parsed.payload : {};
  const data = Array.isArray(payload.data) ? payload.data.filter(isRecord) : [];
  const historyTicks = data
    .map((entry) => ({ price: asNumber(entry.value), timestamp: asNumber(entry.timestamp) }))
    .filter((tick) => Number.isFinite(tick.price) && Number.isFinite(tick.timestamp));
  const updateTick = Number.isFinite(asNumber(payload.value)) && Number.isFinite(asNumber(payload.timestamp))
    ? [{ price: asNumber(payload.value), timestamp: asNumber(payload.timestamp) }]
    : [];
  return [...historyTicks, ...updateTick];
}

async function fetchChainlinkTicksFromRtds(rtdsUrl: string): Promise<{ ticks: ChainlinkTick[]; connected: boolean; error: string | null }> {
  const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => {
    addEventListener: (name: string, listener: (event: { data?: unknown; message?: string; code?: number; reason?: string }) => void) => void;
    send: (data: string) => void;
    close: () => void;
  } }).WebSocket;
  if (!WebSocketCtor) return { ticks: [], connected: false, error: "Runtime WebSocket is unavailable." };

  return new Promise((resolve) => {
    const ticks: ChainlinkTick[] = [];
    let connected = false;
    let resolved = false;
    let ping: ReturnType<typeof setInterval> | null = null;
    const ws = new WebSocketCtor(rtdsUrl);

    const finish = (error: string | null) => {
      if (resolved) return;
      resolved = true;
      if (ping) clearInterval(ping);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve({ ticks, connected, error });
    };

    const timeout = setTimeout(() => finish(ticks.length > 0 ? null : "Timed out waiting for Chainlink RTDS BTC tick."), 3500);

    ws.addEventListener("open", () => {
      connected = true;
      ws.send(JSON.stringify({
        action: "subscribe",
        subscriptions: [
          {
            topic: "crypto_prices_chainlink",
            type: "*",
            filters: JSON.stringify({ symbol: "btc/usd" }),
          },
        ],
      }));
      ping = setInterval(() => {
        try {
          ws.send("PING");
        } catch {
          // connection errors are handled by the error/close listeners
        }
      }, 5000);
    });

    ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : "";
      ticks.push(...extractTicksFromMessage(raw));
      if (ticks.length > 0 && raw.includes("\"type\":\"update\"")) {
        clearTimeout(timeout);
        finish(null);
      }
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timeout);
      finish(event.message || "Chainlink RTDS WebSocket error.");
    });
    ws.addEventListener("close", () => {
      clearTimeout(timeout);
      finish(ticks.length > 0 ? null : "Chainlink RTDS WebSocket closed before a BTC tick arrived.");
    });
  });
}

function rememberTicks(ticks: ChainlinkTick[], now: number) {
  for (const tick of ticks) {
    if (!Number.isFinite(tick.price) || !Number.isFinite(tick.timestamp)) continue;
    chainlinkTicks.push(tick);
  }
  chainlinkTicks.sort((a, b) => a.timestamp - b.timestamp);
  const cutoff = now - 20 * 60 * 1000;
  while (chainlinkTicks.length > 0 && chainlinkTicks[0].timestamp < cutoff) chainlinkTicks.shift();
}

function latestTick(): ChainlinkTick | null {
  return chainlinkTicks[chainlinkTicks.length - 1] ?? null;
}

function estimateVariancePerSecond() {
  const unique = chainlinkTicks.filter((tick, index, arr) => index === 0 || tick.timestamp !== arr[index - 1].timestamp);
  if (unique.length < 3) return { variance: (DEFAULT_ANNUAL_VOL * DEFAULT_ANNUAL_VOL) / SECONDS_PER_YEAR, samples: unique.length, fallback: true };
  const contributions: number[] = [];
  for (let index = 1; index < unique.length; index += 1) {
    const previous = unique[index - 1];
    const current = unique[index];
    const seconds = Math.max((current.timestamp - previous.timestamp) / 1000, 0.001);
    const logReturn = Math.log(current.price / previous.price);
    if (Number.isFinite(logReturn)) contributions.push((logReturn * logReturn) / seconds);
  }
  if (contributions.length < 2) return { variance: (DEFAULT_ANNUAL_VOL * DEFAULT_ANNUAL_VOL) / SECONDS_PER_YEAR, samples: unique.length, fallback: true };
  const variance = contributions.reduce((sum, value) => sum + value, 0) / contributions.length;
  return { variance: Math.max(variance, 1e-12), samples: unique.length, fallback: false };
}

function resolveStrike(market: MarketWindow | null, spot: number | null) {
  if (!market) return { strike: null, source: "unavailable" as const };
  const windowTicks = chainlinkTicks.filter((tick) => tick.timestamp >= market.startTime && tick.timestamp <= market.startTime + 10_000);
  const first = windowTicks[0];
  if (first) return { strike: first.price, source: "chainlink_window_start" as const };
  const earliestObserved = chainlinkTicks.find((tick) => tick.timestamp >= market.startTime && tick.timestamp <= market.endTime);
  if (earliestObserved) return { strike: earliestObserved.price, source: "chainlink_window_observed" as const };
  if (spot) return { strike: spot, source: "current_tick_fallback" as const };
  return { strike: null, source: "unavailable" as const };
}

function probabilityUp(spot: number, strike: number, variancePerSecond: number, secondsRemaining: number) {
  const volTime = Math.sqrt(Math.max(variancePerSecond * Math.max(secondsRemaining, 1), 1e-12));
  return clamp(normalCdf(Math.log(spot / strike) / volTime), 0.001, 0.999);
}

function parseBestBookSide(book: JsonRecord): OrderbookSide {
  const bids = (Array.isArray(book.bids) ? book.bids.filter(isRecord) : [])
    .map((bid) => ({ price: asNumber(bid.price), size: asNumber(bid.size) }))
    .filter((bid) => Number.isFinite(bid.price))
    .sort((a, b) => b.price - a.price);
  const asks = (Array.isArray(book.asks) ? book.asks.filter(isRecord) : [])
    .map((ask) => ({ price: asNumber(ask.price), size: asNumber(ask.size) }))
    .filter((ask) => Number.isFinite(ask.price))
    .sort((a, b) => a.price - b.price);
  const bid = bids[0] ?? null;
  const ask = asks[0] ?? null;
  const mid = bid && ask ? (bid.price + ask.price) / 2 : bid?.price ?? ask?.price ?? null;
  return {
    bid: bid?.price ?? null,
    ask: ask?.price ?? null,
    mid,
    spread: bid && ask ? ask.price - bid.price : null,
    bidSize: Number.isFinite(bid?.size) ? bid?.size ?? null : null,
    askSize: Number.isFinite(ask?.size) ? ask?.size ?? null : null,
  };
}

async function fetchOrderbook(clobUrl: string, tokenId: string | undefined): Promise<OrderbookSide> {
  if (!tokenId) return { bid: null, ask: null, mid: null, spread: null, bidSize: null, askSize: null };
  try {
    const payload = await fetchJson<unknown>(`${clobUrl}/book?token_id=${encodeURIComponent(tokenId)}`, 2500);
    return parseBestBookSide(isRecord(payload) ? payload : {});
  } catch {
    return { bid: null, ask: null, mid: null, spread: null, bidSize: null, askSize: null };
  }
}

async function fetchFastReferencePrice(spot: number | null, now: number): Promise<FastReferencePrice> {
  const endpoints = [
    {
      source: "Binance BTCUSDT",
      url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
      parse: (payload: unknown) => (isRecord(payload) ? asNumber(payload.price) : Number.NaN),
    },
    {
      source: "Coinbase BTC-USD",
      url: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      parse: (payload: unknown) => {
        const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
        return asNumber(data.amount);
      },
    },
  ];
  for (const endpoint of endpoints) {
    try {
      const payload = await fetchJson<unknown>(endpoint.url, 2500);
      const price = endpoint.parse(payload);
      if (!Number.isFinite(price)) throw new Error("price field missing");
      return {
        source: endpoint.source,
        price,
        timestamp: now,
        ageSeconds: 0,
        basisToChainlink: spot ? price - spot : null,
        error: null,
      };
    } catch (error) {
      if (endpoint === endpoints[endpoints.length - 1]) {
        return {
          source: "unavailable",
          price: null,
          timestamp: null,
          ageSeconds: null,
          basisToChainlink: null,
          error: error instanceof Error ? error.message : "Fast reference price unavailable.",
        };
      }
    }
  }
  return { source: "unavailable", price: null, timestamp: null, ageSeconds: null, basisToChainlink: null, error: "Fast reference price unavailable." };
}

function buildCone(spot: number | null, variancePerSecond: number, secondsRemaining: number | null) {
  if (!spot || secondsRemaining === null) {
    return { lower68: null, upper68: null, lower95: null, upper95: null, expectedMove68: null, expectedMove95: null };
  }
  const sigma = Math.sqrt(Math.max(variancePerSecond * Math.max(secondsRemaining, 1), 1e-12));
  const lower68 = spot * Math.exp(-sigma);
  const upper68 = spot * Math.exp(sigma);
  const lower95 = spot * Math.exp(-2 * sigma);
  const upper95 = spot * Math.exp(2 * sigma);
  return {
    lower68,
    upper68,
    lower95,
    upper95,
    expectedMove68: Math.max(Math.abs(spot - lower68), Math.abs(upper68 - spot)),
    expectedMove95: Math.max(Math.abs(spot - lower95), Math.abs(upper95 - spot)),
  };
}

function timeoutMonitor(now: number, detail: string): BtcFiveMinuteMonitor {
  if (lastMonitor) {
    return {
      ...lastMonitor,
      status: lastMonitor.status === "critical" ? "critical" : "warning",
      updatedAt: now,
      model: {
        ...lastMonitor.model,
        warnings: [...lastMonitor.model.warnings, detail],
      },
    };
  }
  return {
    mode: "read_only",
    status: "critical",
    updatedAt: now,
    rtds: {
      connected: false,
      topic: "crypto_prices_chainlink",
      symbol: "btc/usd",
      price: null,
      timestamp: null,
      ageSeconds: null,
      tickCount: chainlinkTicks.length,
      error: detail,
    },
    market: null,
    orderbook: {
      up: { bid: null, ask: null, mid: null, spread: null, bidSize: null, askSize: null },
      down: { bid: null, ask: null, mid: null, spread: null, bidSize: null, askSize: null },
    },
    fastReference: {
      source: "unavailable",
      price: null,
      timestamp: null,
      ageSeconds: null,
      basisToChainlink: null,
      error: detail,
    },
    model: {
      spot: null,
      openPrice: null,
      openPriceSource: "unavailable",
      secondsRemaining: null,
      annualizedVol: null,
      sampleCount: 0,
      probabilityUp: null,
      probabilityDown: null,
      edgeUp: null,
      edgeDown: null,
      cone: { lower68: null, upper68: null, lower95: null, upper95: null, expectedMove68: null, expectedMove95: null },
      minEdge: DEFAULT_MIN_EDGE,
      decision: "blocked",
      reasons: [detail],
      warnings: [],
    },
    notes: [
      "Polymarket BTC 5m settlement source is Chainlink BTC/USD data stream via public RTDS.",
      "This monitor is read-only and never signs or submits Polymarket orders.",
    ],
  };
}

async function buildBtcFiveMinuteMonitor(options: MonitorOptions = {}): Promise<BtcFiveMinuteMonitor> {
  const now = options.now?.() ?? Date.now();
  const gammaUrl = options.gammaUrl ?? envValue("POLYMARKET_GAMMA_API_BASE") ?? "https://gamma-api.polymarket.com";
  const clobUrl = options.clobUrl ?? envValue("POLYMARKET_API_BASE") ?? "https://clob.polymarket.com";
  const rtdsUrl = options.rtdsUrl ?? envValue("POLYMARKET_RTDS_WS_URL") ?? "wss://ws-live-data.polymarket.com";
  const minEdge = options.minEdge ?? DEFAULT_MIN_EDGE;

  const [market, rtds] = await Promise.all([
    discoverBtcFiveMinuteMarket(gammaUrl, now),
    options.fetchChainlinkTicks ? options.fetchChainlinkTicks() : fetchChainlinkTicksFromRtds(rtdsUrl),
  ]);
  rememberTicks(rtds.ticks, now);
  const tick = latestTick();
  const spot = tick?.price ?? null;
  const [upBook, downBook, fastReference] = await Promise.all([
    fetchOrderbook(clobUrl, market?.upTokenId),
    fetchOrderbook(clobUrl, market?.downTokenId),
    options.fetchFastReference ? options.fetchFastReference() : fetchFastReferencePrice(spot, now),
  ]);

  const blockers: string[] = [];
  const warnings: string[] = [];
  const notes: string[] = [
    "Polymarket BTC 5m settlement source is Chainlink BTC/USD data stream via public RTDS.",
    "This monitor is read-only and never signs or submits Polymarket orders.",
  ];
  if (!market) blockers.push("No active btc-updown-5m market was discovered in the current window scan.");
  if (!tick) blockers.push("No Chainlink BTC/USD RTDS tick is available.");
  const ageSeconds = tick ? Math.max(0, (now - tick.timestamp) / 1000) : null;
  if (ageSeconds !== null && ageSeconds > 10) warnings.push(`Chainlink tick is stale by ${ageSeconds.toFixed(1)}s.`);
  if (upBook.ask === null) blockers.push("UP ask is unavailable from CLOB order book.");
  if (downBook.ask === null) blockers.push("DOWN ask is unavailable from CLOB order book.");

  const secondsRemaining = market ? Math.max(0, (market.endTime - now) / 1000) : null;
  if (secondsRemaining !== null && secondsRemaining < 15) blockers.push("Current 5m market is inside the final 15 seconds.");
  else if (secondsRemaining !== null && secondsRemaining < 30) warnings.push("Current 5m market is inside the final 30 seconds.");
  const openPrice = resolveStrike(market, spot);
  if (market && now < market.startTime) blockers.push("Selected BTC 5m market has not opened yet.");
  if (openPrice.source === "chainlink_window_observed") warnings.push("Exact window-start Chainlink tick is not cached; using earliest observed tick inside this window.");
  if (openPrice.source === "current_tick_fallback") warnings.push("Window-start Chainlink tick is not cached yet; using current tick as neutral fallback.");
  if (openPrice.source === "unavailable") blockers.push("No usable opening price is available.");
  const vol = estimateVariancePerSecond();
  if (vol.fallback) warnings.push("Using fallback BTC annualized volatility until enough RTDS samples are cached.");

  if (fastReference.price !== null && spot !== null && Math.abs(fastReference.price - spot) > 20) {
    warnings.push(`Fast reference differs from Chainlink by $${Math.abs(fastReference.price - spot).toFixed(2)}; settlement feed may be lagging.`);
  }
  if (fastReference.error) warnings.push(`Fast reference unavailable: ${fastReference.error}`);

  let pUp: number | null = null;
  let pDown: number | null = null;
  let edgeUp: number | null = null;
  let edgeDown: number | null = null;
  if (spot && openPrice.strike && secondsRemaining !== null) {
    pUp = probabilityUp(spot, openPrice.strike, vol.variance, secondsRemaining);
    pDown = 1 - pUp;
    edgeUp = upBook.ask !== null ? pUp - upBook.ask : null;
    edgeDown = downBook.ask !== null ? pDown - downBook.ask : null;
  }
  const cone = buildCone(spot, vol.variance, secondsRemaining);

  let decision: BtcFiveMinuteMonitor["model"]["decision"] = "blocked";
  if (blockers.length === 0) {
    const upEdge = edgeUp ?? -Infinity;
    const downEdge = edgeDown ?? -Infinity;
    if (upEdge >= minEdge && upEdge >= downEdge) decision = "strong_up";
    else if (downEdge >= minEdge) decision = "strong_down";
    else if (upEdge > DEFAULT_LEAN_EDGE && upEdge >= downEdge) decision = "lean_up";
    else if (downEdge > DEFAULT_LEAN_EDGE) decision = "lean_down";
    else decision = "no_edge";
  }

  const status: BtcFiveMinuteMonitor["status"] = blockers.length > 0 ? "critical" : warnings.length > 0 ? "warning" : "healthy";
  const monitor: BtcFiveMinuteMonitor = {
    mode: "read_only",
    status,
    updatedAt: now,
    rtds: {
      connected: rtds.connected,
      topic: "crypto_prices_chainlink",
      symbol: "btc/usd",
      price: spot,
      timestamp: tick?.timestamp ?? null,
      ageSeconds,
      tickCount: chainlinkTicks.length,
      error: rtds.error,
    },
    market,
    orderbook: {
      up: upBook,
      down: downBook,
    },
    fastReference,
    model: {
      spot,
      openPrice: openPrice.strike,
      openPriceSource: openPrice.source,
      secondsRemaining,
      annualizedVol: Math.sqrt(vol.variance * SECONDS_PER_YEAR),
      sampleCount: vol.samples,
      probabilityUp: pUp,
      probabilityDown: pDown,
      edgeUp,
      edgeDown,
      cone,
      minEdge,
      decision,
      reasons: blockers,
      warnings,
    },
    notes,
  };
  lastMonitor = monitor;
  return monitor;
}

export async function getBtcFiveMinuteMonitor(options: MonitorOptions = {}): Promise<BtcFiveMinuteMonitor> {
  const now = options.now?.() ?? Date.now();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      buildBtcFiveMinuteMonitor(options),
      new Promise<BtcFiveMinuteMonitor>((resolve) => {
        timeout = setTimeout(() => resolve(timeoutMonitor(now, "BTC 5m monitor refresh timed out; showing last available snapshot.")), 8000);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
