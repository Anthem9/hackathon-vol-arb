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

export class BtcPriceAdapter {
  private readonly now: () => number;

  constructor(options: PriceAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async fetchSpot(): Promise<BtcPriceState> {
    const startedAt = this.now();
    const settled = await Promise.allSettled([this.fetchCoinGecko(), this.fetchCoinbase()]);
    const sources = settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
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
            ? `${sources.length} free source(s), divergence ${(divergence * 100).toFixed(2)}%.`
            : "No BTC price source returned data.",
        error: errors.length > 0 ? errors.join("; ") : undefined,
      },
    };
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
}
