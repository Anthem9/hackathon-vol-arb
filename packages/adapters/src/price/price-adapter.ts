import type { DataSourceStatus } from "@vol-arb/core";

type JsonRecord = Record<string, unknown>;

export type BtcPriceState = {
  spot: number;
  sources: {
    source: string;
    price: number;
    lastUpdatedAt: number | null;
  }[];
  status: DataSourceStatus;
};

type PriceAdapterOptions = {
  now?: () => number;
  configuredSourceUrl?: string;
  configuredHeaderName?: string;
  configuredHeaderValue?: string;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown, fallback = Number.NaN): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeTimestamp(value: unknown) {
  const parsed = asNumber(value, 0);
  if (!parsed) return null;
  return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function extractPrice(payload: unknown) {
  const record = isRecord(payload) ? payload : {};
  const data = isRecord(record.data) ? record.data : {};
  const bitcoin = isRecord(record.bitcoin) ? record.bitcoin : {};
  for (const value of [record.price, record.usd, record.BTCUSD, record.last, record.rate, data.amount, data.price, bitcoin.usd]) {
    const parsed = asNumber(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.NaN;
}

async function fetchJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export class BtcPriceAdapter {
  private readonly now: () => number;
  private readonly configuredSourceUrl: string;
  private readonly configuredHeaderName: string;
  private readonly configuredHeaderValue: string;

  constructor(options: PriceAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
    this.configuredSourceUrl = options.configuredSourceUrl?.trim() ?? "";
    this.configuredHeaderName = options.configuredHeaderName?.trim() ?? "";
    this.configuredHeaderValue = options.configuredHeaderValue?.trim() ?? "";
  }

  async fetchSpot(): Promise<BtcPriceState> {
    const startedAt = this.now();
    const configuredSource = this.fetchConfigured();
    const settled = await Promise.allSettled([
      ...(configuredSource ? [configuredSource] : []),
      this.fetchCoinGecko(),
      this.fetchCoinbase(),
      this.fetchKraken(),
    ]);
    const sources = settled
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .filter((source) => Number.isFinite(source.price) && source.price > 0);
    const errors = settled.flatMap((result) => (result.status === "rejected" ? [String(result.reason)] : []));
    const spot = sources.length > 0 ? sources.reduce((sum, source) => sum + source.price, 0) / sources.length : 0;
    const max = Math.max(...sources.map((source) => source.price));
    const min = Math.min(...sources.map((source) => source.price));
    const divergence = spot > 0 && sources.length > 1 ? (max - min) / spot : 0;
    const status = sources.length === 0 ? "critical" : divergence > 0.01 || sources.length === 1 ? "warning" : "healthy";

    return {
      spot,
      sources,
      status: {
        sourceId: "btc-price",
        label: "BTC Spot Price",
        status,
        mode: "real",
        lastUpdatedAt: this.now(),
        latencyMs: this.now() - startedAt,
        detail:
          sources.length > 0
            ? `${sources.length} source(s), divergence ${(divergence * 100).toFixed(2)}%.`
            : "No BTC price source returned data.",
        error: errors.length > 0 ? errors.join("; ") : undefined,
      },
    };
  }

  private fetchConfigured() {
    const url = this.configuredSourceUrl;
    if (!url) return null;
    const headers = this.configuredHeaderName && this.configuredHeaderValue ? { [this.configuredHeaderName]: this.configuredHeaderValue } : undefined;

    return fetchJson<unknown>(url, headers).then((payload) => {
      const record = isRecord(payload) ? payload : {};
      const data = isRecord(record.data) ? record.data : {};
      return {
        source: "Configured",
        price: extractPrice(payload),
        lastUpdatedAt: normalizeTimestamp(record.last_updated_at ?? record.timestamp ?? record.time ?? data.last_updated_at ?? data.timestamp),
      };
    });
  }

  private async fetchCoinGecko() {
    const payload = await fetchJson<unknown>(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true",
    );
    const bitcoin = isRecord(payload) && isRecord(payload.bitcoin) ? payload.bitcoin : {};
    return {
      source: "CoinGecko",
      price: asNumber(bitcoin.usd),
      lastUpdatedAt: asNumber(bitcoin.last_updated_at, 0) * 1000 || null,
    };
  }

  private async fetchCoinbase() {
    const payload = await fetchJson<unknown>("https://api.coinbase.com/v2/prices/BTC-USD/spot");
    const data = isRecord(payload) && isRecord(payload.data) ? payload.data : {};
    return {
      source: "Coinbase",
      price: asNumber(data.amount),
      lastUpdatedAt: this.now(),
    };
  }

  private async fetchKraken() {
    const payload = await fetchJson<unknown>("https://api.kraken.com/0/public/Ticker?pair=XBTUSD");
    const result = isRecord(payload) && isRecord(payload.result) ? payload.result : {};
    const ticker = Object.values(result).find(isRecord) ?? {};
    const close = Array.isArray(ticker.c) ? ticker.c[0] : undefined;
    return {
      source: "Kraken",
      price: asNumber(close),
      lastUpdatedAt: this.now(),
    };
  }
}
