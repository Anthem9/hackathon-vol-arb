import type {
  DataMode,
  DataSourceStatus,
  ExecutableEdge,
  Overview,
  PaperTrade,
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
  mode: DataMode;
};

export async function fetchDashboardData(): Promise<DashboardApiData> {
  const [overview, surfaces, opportunities, sviHealth, paperTrades, riskRules, sourceStatusPayload] = await Promise.all([
    getJson<Overview>("/api/overview"),
    getJson<VolSurface[]>("/api/surfaces"),
    getJson<ExecutableEdge[]>("/api/opportunities"),
    getJson<SviHealthReport[]>("/api/svi-health"),
    getJson<PaperTrade[]>("/api/paper-trades"),
    getJson<RiskRule[]>("/api/risk-rules"),
    getJson<Pick<DashboardApiData, "mode" | "sourceStatuses">>("/api/source-statuses"),
  ]);
  return { overview, surfaces, opportunities, sviHealth, paperTrades, riskRules, ...sourceStatusPayload };
}
