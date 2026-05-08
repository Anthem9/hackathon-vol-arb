import type {
  AlertEvent,
  DataMode,
  DataSourceStatus,
  ExecutableEdge,
  Overview,
  PaperTrade,
  PersistenceStatus,
  RiskRule,
  SviHealthReport,
  VolSurface,
} from "@vol-arb/core";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`API ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type DashboardApiData = {
  overview: Overview;
  surfaces: VolSurface[];
  opportunities: ExecutableEdge[];
  sviHealth: SviHealthReport[];
  paperTrades: PaperTrade[];
  riskRules: RiskRule[];
  sourceStatuses: DataSourceStatus[];
  alerts: AlertEvent[];
  persistence: PersistenceStatus;
  mode: DataMode;
};

export async function fetchDashboardData(): Promise<DashboardApiData> {
  const [overview, surfaces, opportunities, sviHealth, paperTrades, riskRules, sourceStatusPayload, alerts, persistence] = await Promise.all([
    getJson<Overview>("/api/overview"),
    getJson<VolSurface[]>("/api/surfaces"),
    getJson<ExecutableEdge[]>("/api/opportunities"),
    getJson<SviHealthReport[]>("/api/svi-health"),
    getJson<PaperTrade[]>("/api/paper-trades"),
    getJson<RiskRule[]>("/api/risk-rules"),
    getJson<Pick<DashboardApiData, "mode" | "sourceStatuses" | "persistence">>("/api/source-statuses"),
    getJson<AlertEvent[]>("/api/alerts"),
    getJson<PersistenceStatus>("/api/persistence"),
  ]);
  return {
    overview,
    surfaces,
    opportunities,
    sviHealth,
    paperTrades,
    riskRules,
    alerts,
    persistence: sourceStatusPayload.persistence ?? persistence,
    mode: sourceStatusPayload.mode,
    sourceStatuses: sourceStatusPayload.sourceStatuses,
  };
}

export async function createDeepBookIntent(payload: Record<string, unknown>) {
  const response = await fetch(`${API_BASE_URL}/api/deepbook/intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`DeepBook intent failed with ${response.status}`);
  }
  return response.json() as Promise<{
    network: string;
    safeMode: string;
    action: string;
    description: string;
    calls: Array<Record<string, unknown>>;
  }>;
}
