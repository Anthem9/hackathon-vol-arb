import { binaryAboveFairValue, probabilityToDisplayIv, scoreExecutableEdge, type DataSourceStatus, type ExecutableEdge } from "@vol-arb/core";
import type { DeepBookOracleSnapshot } from "../deepbook/deepbook-adapter";

type JsonRecord = Record<string, unknown>;

export type PolymarketBtcMarket = {
  marketId: string;
  conditionId: string;
  question: string;
  slug: string;
  expiry: number;
  strike: number | null;
  yesTokenId: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  liquidity: number;
  updatedAt: number | null;
};

type PolymarketAdapterOptions = {
  gammaUrl?: string;
  clobUrl?: string;
  now?: () => number;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function envValue(name: string): string | undefined {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return maybeProcess?.env?.[name];
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

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function parseStrike(question: string, slug: string): number | null {
  const text = `${question} ${slug}`.toLowerCase();
  const millionMatch = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*m\b/);
  if (millionMatch) return Number(millionMatch[1]) * 1_000_000;
  const kMatch = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*k\b/);
  if (kMatch) return Number(kMatch[1]) * 1_000;
  const rawMatch = text.match(/\$?\s*(\d{5,7})(?:\D|$)/);
  return rawMatch ? Number(rawMatch[1]) : null;
}

function bestBid(book: JsonRecord): number | null {
  const bids = Array.isArray(book.bids) ? book.bids.filter(isRecord) : [];
  const prices = bids.map((bid) => asNumber(bid.price, Number.NaN)).filter(Number.isFinite);
  return prices.length > 0 ? Math.max(...prices) : null;
}

function bestAsk(book: JsonRecord): number | null {
  const asks = Array.isArray(book.asks) ? book.asks.filter(isRecord) : [];
  const prices = asks.map((ask) => asNumber(ask.price, Number.NaN)).filter(Number.isFinite);
  return prices.length > 0 ? Math.min(...prices) : null;
}

export class PolymarketAdapter {
  venueName = "Polymarket";
  private readonly gammaUrl: string;
  private readonly clobUrl: string;
  private readonly now: () => number;

  constructor(options: PolymarketAdapterOptions = {}) {
    this.gammaUrl = options.gammaUrl ?? envValue("POLYMARKET_GAMMA_API_BASE") ?? "https://gamma-api.polymarket.com";
    this.clobUrl = options.clobUrl ?? envValue("POLYMARKET_API_BASE") ?? "https://clob.polymarket.com";
    this.now = options.now ?? Date.now;
  }

  async healthCheck(): Promise<DataSourceStatus> {
    const startedAt = this.now();
    try {
      const response = await fetch(`${this.clobUrl}/`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return {
        sourceId: "polymarket",
        label: "Polymarket Gamma + CLOB",
        status: "healthy",
        mode: "real",
        lastUpdatedAt: this.now(),
        latencyMs: this.now() - startedAt,
        detail: "CLOB health endpoint returned OK.",
      };
    } catch (error) {
      return {
        sourceId: "polymarket",
        label: "Polymarket Gamma + CLOB",
        status: "critical",
        mode: "real",
        lastUpdatedAt: this.now(),
        latencyMs: this.now() - startedAt,
        detail: "Polymarket public APIs are unavailable.",
        error: error instanceof Error ? error.message : "Unknown Polymarket error",
      };
    }
  }

  async fetchBtcMarkets(limit = 5): Promise<{ markets: PolymarketBtcMarket[]; status: DataSourceStatus }> {
    const startedAt = this.now();
    try {
      const payload = await fetchJson<unknown>(
        `${this.gammaUrl}/markets?limit=100&active=true&closed=false&archived=false&tag_slug=crypto`,
      );
      const rows = (Array.isArray(payload) ? payload : [])
        .filter(isRecord)
        .filter((row) => /bitcoin|btc/i.test([row.question, row.description, row.slug].map((value) => asString(value)).join(" ")))
        .slice(0, limit);

      const markets = await Promise.all(rows.map((row) => this.normalizeMarket(row)));
      const valid = markets.filter((market): market is PolymarketBtcMarket => market !== null);
      return {
        markets: valid,
        status: {
          sourceId: "polymarket",
          label: "Polymarket Gamma + CLOB",
          status: valid.length > 0 ? "healthy" : "warning",
          mode: "real",
          lastUpdatedAt: this.now(),
          latencyMs: this.now() - startedAt,
          detail: `Discovered ${valid.length} active BTC-related public market(s).`,
        },
      };
    } catch (error) {
      return {
        markets: [],
        status: {
          sourceId: "polymarket",
          label: "Polymarket Gamma + CLOB",
          status: "critical",
          mode: "real",
          lastUpdatedAt: this.now(),
          latencyMs: this.now() - startedAt,
          detail: "Falling back because Polymarket public market data could not be read.",
          error: error instanceof Error ? error.message : "Unknown Polymarket read error",
        },
      };
    }
  }

  buildOpportunities(markets: PolymarketBtcMarket[], oracle: DeepBookOracleSnapshot | undefined, fallbackSpot: number): ExecutableEdge[] {
    return markets.map((market) => {
      const strike = market.strike ?? fallbackSpot;
      const spot = oracle?.spot ?? fallbackSpot;
      const yearsToExpiry = Math.max((market.expiry - this.now()) / (365 * 24 * 60 * 60 * 1000), 1 / 365);
      const roughIv = oracle ? probabilityToDisplayIv(market.mid ?? 0.5, strike, spot) : 0.75;
      const deepbookFair = binaryAboveFairValue(spot, strike, roughIv, yearsToExpiry);
      const bid = market.bid ?? market.mid ?? 0.5;
      const ask = market.ask ?? market.mid ?? 0.5;
      const mid = market.mid ?? (bid + ask) / 2;
      const rawSpread = Math.abs(mid - deepbookFair);
      const spreadCost = Math.max(0, ask - bid);
      const feeAdjusted = rawSpread - spreadCost - 0.01;
      const expiryMismatch = oracle ? Math.abs(market.expiry - oracle.expiry) > 24 * 60 * 60 * 1000 : true;
      const scored = scoreExecutableEdge({
        opportunityId: `real-pm-${market.marketId}`,
        sourceVenue: "DeepBook Predict OracleSVI",
        targetVenue: "Polymarket CLOB",
        underlying: "BTC",
        expiry: market.expiry,
        strike,
        rawVolSpread: Number(rawSpread.toFixed(4)),
        bidAskAdjustedSpread: Number((rawSpread - spreadCost).toFixed(4)),
        feeAdjustedSpread: Number(feeAdjusted.toFixed(4)),
        hedgeAdjustedSpread: Number((feeAdjusted - 0.01).toFixed(4)),
        latencyAdjustedSpread: Number((feeAdjusted - 0.014).toFixed(4)),
        finalExecutableEdge: Number((feeAdjusted - 0.014).toFixed(4)),
        recommendedSizeUsd: expiryMismatch ? 0 : Math.min(500, market.liquidity * 0.01),
        maxSizeUsd: expiryMismatch ? 0 : Math.min(1000, market.liquidity * 0.02),
        confidenceScore: expiryMismatch ? 0.56 : 0.72,
        riskScore: expiryMismatch ? 0.74 : 0.48,
        tradabilityScore: market.spread !== null && market.spread < 0.08 ? 0.76 : 0.58,
        timestamp: this.now(),
      });
      return {
        ...scored,
        rejectReasons: [
          ...(scored.rejectReasons ?? []),
          ...(expiryMismatch ? ["DeepBook testnet oracle expiry does not match Polymarket settlement horizon"] : []),
        ],
      };
    });
  }

  private async normalizeMarket(row: JsonRecord): Promise<PolymarketBtcMarket | null> {
    const tokenIds = parseJsonArray(row.clobTokenIds).map((value) => String(value));
    const yesTokenId = tokenIds[0];
    if (!yesTokenId) return null;
    const book = await fetchJson<JsonRecord>(`${this.clobUrl}/book?token_id=${encodeURIComponent(yesTokenId)}`);
    const bid = bestBid(book);
    const ask = bestAsk(book);
    const midpoint: JsonRecord = await fetchJson<JsonRecord>(`${this.clobUrl}/midpoint?token_id=${encodeURIComponent(yesTokenId)}`).catch(() => ({}));
    const mid = asNumber(midpoint.mid, bid !== null && ask !== null ? (bid + ask) / 2 : Number.NaN);
    return {
      marketId: asString(row.id),
      conditionId: asString(row.conditionId),
      question: asString(row.question),
      slug: asString(row.slug),
      expiry: Date.parse(asString(row.endDate)),
      strike: parseStrike(asString(row.question), asString(row.slug)),
      yesTokenId,
      bid,
      ask,
      mid: Number.isFinite(mid) ? mid : null,
      spread: bid !== null && ask !== null ? Number((ask - bid).toFixed(4)) : null,
      liquidity: asNumber(row.liquidityNum),
      updatedAt: Number.isFinite(Date.parse(asString(row.updatedAt))) ? Date.parse(asString(row.updatedAt)) : null,
    };
  }
}
