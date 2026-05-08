import {
  binaryAboveFairValue,
  buildSurface,
  impliedVolFromSvi,
  type DataSourceStatus,
  type HealthStatus,
  type SviHealthReport,
  type SviParams,
  type VolSurface,
} from "@vol-arb/core";

type JsonRecord = Record<string, unknown>;

export type DeepBookOracleSnapshot = {
  oracleId: string;
  underlying: string;
  expiry: number;
  active: boolean;
  spot: number;
  forward: number;
  timestamp: number;
  params: SviParams;
};

type DeepBookAdapterOptions = {
  serverUrl?: string;
  rpcUrl?: string;
  now?: () => number;
};

const PRICE_SCALE = 1_000_000_000;
const SVI_SCALE = 1_000_000;
const RHO_SCALE = 1_000_000_000;
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

function envValue(name: string): string | undefined {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return maybeProcess?.env?.[name];
}

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

function parseSignedFixedPoint(value: unknown, scale: number): number {
  if (!isRecord(value)) return asNumber(value) / scale;
  const fields = isRecord(value.fields) ? value.fields : {};
  const magnitude = asNumber(fields.magnitude);
  return fields.is_negative === true ? -magnitude / scale : magnitude / scale;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as T;
  } catch (error) {
    const elapsed = Date.now() - startedAt;
    throw new Error(`${url} failed after ${elapsed}ms: ${error instanceof Error ? error.message : "unknown error"}`);
  } finally {
    clearTimeout(timeout);
  }
}

function sourceStatus(status: HealthStatus, detail: string, latencyMs?: number, error?: string): DataSourceStatus {
  return {
    sourceId: "deepbook-predict",
    label: "DeepBook Predict Testnet",
    status,
    mode: "real",
    lastUpdatedAt: Date.now(),
    latencyMs,
    detail,
    error,
  };
}

function parseOracleObject(oracleId: string, payload: JsonRecord): DeepBookOracleSnapshot | null {
  const result = isRecord(payload.result) ? payload.result : {};
  const data = isRecord(result.data) ? result.data : {};
  const content = isRecord(data.content) ? data.content : {};
  const fields = isRecord(content.fields) ? content.fields : {};
  const prices = isRecord(fields.prices) && isRecord(fields.prices.fields) ? fields.prices.fields : {};
  const svi = isRecord(fields.svi) && isRecord(fields.svi.fields) ? fields.svi.fields : {};

  const expiry = asNumber(fields.expiry);
  const timestamp = asNumber(fields.timestamp);
  const spot = asNumber(prices.spot) / PRICE_SCALE;
  const forward = asNumber(prices.forward) / PRICE_SCALE;
  if (!expiry || !timestamp || !spot || !forward) return null;

  return {
    oracleId,
    underlying: asString(fields.underlying_asset, "BTC"),
    expiry,
    active: fields.active === true,
    spot,
    forward,
    timestamp,
    params: {
      a: asNumber(svi.a) / SVI_SCALE,
      b: asNumber(svi.b) / SVI_SCALE,
      rho: parseSignedFixedPoint(svi.rho, RHO_SCALE),
      m: parseSignedFixedPoint(svi.m, SVI_SCALE),
      sigma: asNumber(svi.sigma) / SVI_SCALE,
    },
  };
}

export class DeepBookPredictAdapter {
  venueName = "DeepBook Predict";
  private readonly serverUrl: string;
  private readonly rpcUrl: string;
  private readonly now: () => number;

  constructor(options: DeepBookAdapterOptions = {}) {
    this.serverUrl = options.serverUrl ?? envValue("DEEPBOOK_PREDICT_SERVER_URL") ?? "https://predict-server.testnet.mystenlabs.com";
    this.rpcUrl = options.rpcUrl ?? envValue("SUI_TESTNET_RPC_HTTPS") ?? "https://fullnode.testnet.sui.io:443";
    this.now = options.now ?? Date.now;
  }

  async healthCheck(): Promise<DataSourceStatus> {
    const startedAt = this.now();
    try {
      const oracles = await this.fetchOracleList();
      return sourceStatus("healthy", `Indexed server returned ${oracles.length} oracle records.`, this.now() - startedAt);
    } catch (error) {
      return sourceStatus(
        "critical",
        "DeepBook Predict indexed server is unavailable.",
        this.now() - startedAt,
        error instanceof Error ? error.message : "Unknown DeepBook error",
      );
    }
  }

  async fetchOracleList(): Promise<JsonRecord[]> {
    const payload = await fetchJson<unknown>(`${this.serverUrl}/oracles`);
    return Array.isArray(payload) ? payload.filter(isRecord) : [];
  }

  async fetchActiveBtcOracles(limit = 3): Promise<DeepBookOracleSnapshot[]> {
    const now = this.now();
    const oracleRows = (await this.fetchOracleList())
      .filter((row) => asString(row.underlying_asset) === "BTC")
      .filter((row) => asString(row.status) === "active")
      .filter((row) => asNumber(row.expiry) > now)
      .sort((a, b) => asNumber(a.expiry) - asNumber(b.expiry))
      .slice(0, limit);

    const snapshots = await Promise.all(
      oracleRows.map(async (row) => {
        const oracleId = asString(row.oracle_id);
        if (!oracleId) return null;
        const payload = await fetchJson<JsonRecord>(this.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sui_getObject",
            params: [oracleId, { showContent: true, showType: true }],
          }),
        });
        return parseOracleObject(oracleId, payload);
      }),
    );

    return snapshots.filter((snapshot): snapshot is DeepBookOracleSnapshot => snapshot !== null);
  }

  buildSurfaces(oracles: DeepBookOracleSnapshot[]): VolSurface[] {
    return oracles.map((oracle) => {
      const yearsToExpiry = Math.max((oracle.expiry - this.now()) / MS_PER_YEAR, 1 / (365 * 24));
      const strikes = [0.86, 0.91, 0.96, 1, 1.04, 1.09, 1.14].map((ratio) =>
        Math.round((oracle.spot * ratio) / 1000) * 1000,
      );
      const fairValues = new Map(
        strikes.map((strike) => {
          const iv = impliedVolFromSvi(oracle.params, strike, oracle.forward, yearsToExpiry);
          return [strike, Number(binaryAboveFairValue(oracle.spot, strike, iv, yearsToExpiry).toFixed(4))] as const;
        }),
      );
      const instruments = strikes.map((strike, index) => {
        const fair = fairValues.get(strike) ?? 0.5;
        const proxyMid = Math.max(0.03, Math.min(0.97, fair + (index - 3) * 0.012));
        const spread = index === 3 ? 0.03 : 0.045;
        return {
          instrumentId: `hybrid-external-btc-${oracle.oracleId}-${strike}`,
          venue: "External Hybrid Proxy",
          underlying: "BTC",
          expiry: oracle.expiry,
          strike,
          payoffType: "binary" as const,
          direction: "above" as const,
          quoteCurrency: "USDC",
          bid: Number(Math.max(0.01, proxyMid - spread / 2).toFixed(4)),
          ask: Number(Math.min(0.99, proxyMid + spread / 2).toFixed(4)),
          mid: Number(proxyMid.toFixed(4)),
          liquidityScore: 0.58,
          settlementSource: "Hybrid external proxy anchored by public market data availability",
          settlementRule: "Pays 1 USDC if BTC closes above strike at expiry",
          timestamp: this.now(),
          confidenceScore: 0.62,
        };
      });
      const lagSeconds = Math.max(0, Math.round((this.now() - oracle.timestamp) / 1000));
      return buildSurface(`${Math.max(1, Math.round((oracle.expiry - this.now()) / 60000))}m`, oracle.expiry, instruments, fairValues, oracle.spot, {
        venue: "DeepBook Predict real SVI + external hybrid proxy",
        surfaceQualityScore: lagSeconds < 60 ? 0.82 : 0.68,
        staleScore: Math.min(1, lagSeconds / 240),
        lastUpdatedAt: oracle.timestamp,
      });
    });
  }

  buildHealthReports(oracles: DeepBookOracleSnapshot[]): SviHealthReport[] {
    return oracles.map((oracle) => {
      const lagSeconds = Math.max(0, Math.round((this.now() - oracle.timestamp) / 1000));
      const status: HealthStatus = lagSeconds > 240 ? "stale" : lagSeconds > 90 ? "warning" : "healthy";
      return {
        oracleId: oracle.oracleId,
        underlying: oracle.underlying,
        expiry: oracle.expiry,
        label: `${Math.max(1, Math.round((oracle.expiry - this.now()) / 60000))}m`,
        lastUpdatedAt: oracle.timestamp,
        lagSeconds,
        staleScore: Math.min(1, lagSeconds / 240),
        surfaceJumpScore: Math.min(0.95, Math.abs(oracle.params.rho) + oracle.params.sigma * 0.2),
        externalDeviationScore: 0.34,
        abnormalPoints: oracle.active ? 0 : 1,
        status,
        reasons: [
          `Real OracleSVI spot ${oracle.spot.toFixed(2)} forward ${oracle.forward.toFixed(2)}`,
          `SVI a=${oracle.params.a.toFixed(4)} b=${oracle.params.b.toFixed(4)} rho=${oracle.params.rho.toFixed(3)}`,
        ],
      };
    });
  }

  async getMarketState(): Promise<{ oracles: DeepBookOracleSnapshot[]; status: DataSourceStatus }> {
    const startedAt = this.now();
    try {
      const oracles = await this.fetchActiveBtcOracles();
      return {
        oracles,
        status: sourceStatus("healthy", `Loaded ${oracles.length} active BTC OracleSVI objects from Sui testnet.`, this.now() - startedAt),
      };
    } catch (error) {
      return {
        oracles: [],
        status: sourceStatus(
          "critical",
          "Falling back because DeepBook Predict or Sui RPC could not be read.",
          this.now() - startedAt,
          error instanceof Error ? error.message : "Unknown DeepBook read error",
        ),
      };
    }
  }
}
