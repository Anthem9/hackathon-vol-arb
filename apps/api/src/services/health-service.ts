import type { HealthStatus } from "@vol-arb/core";
import { getDatabaseStatus } from "../db/postgres";
import { getSourceStatuses } from "./dashboard-service";
import { getMaintenanceStatus } from "./maintenance-service";

function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("warning")) return "warning";
  return "healthy";
}

export async function getApiHealth(options: { deep?: boolean } = {}) {
  const database = getDatabaseStatus();
  const maintenance = getMaintenanceStatus();
  const baseStatuses: HealthStatus[] = [database.status];
  let sources:
    | Awaited<ReturnType<typeof getSourceStatuses>>
    | null = null;

  if (options.deep) {
    sources = await getSourceStatuses();
    baseStatuses.push(...sources.sourceStatuses.map((source) => source.status), sources.persistence.status);
  }

  return {
    status: worstStatus(baseStatuses),
    service: "vol-arb-api",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: Date.now(),
    mode: process.env.DATA_MODE === "real" ? "real" : process.env.DATA_MODE === "hybrid" ? "hybrid" : "mock",
    database,
    maintenance: {
      schedulerEnabled: maintenance.schedulerEnabled,
      schedulerStarted: maintenance.schedulerStarted,
      running: maintenance.running,
      lastRunStatus: maintenance.lastRun?.status ?? null,
      lastRunAt: maintenance.lastRun?.finishedAt ?? maintenance.lastRun?.startedAt ?? null,
    },
    sources,
  };
}
