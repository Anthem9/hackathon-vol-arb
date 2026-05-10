import { MockVenueAdapter, RealDashboardAdapter } from "@vol-arb/adapters";
import type { DashboardData, DataMode } from "@vol-arb/core";
import { persistDashboardSnapshot } from "../db/postgres";
import { applyAlertOperatorActions, buildAlerts } from "./alert-service";

const REAL_SNAPSHOT_TTL_MS = 5000;

let cachedRealSnapshot: {
  mode: DataMode;
  createdAt: number;
  promise: Promise<DashboardData>;
} | null = null;

function dataMode(): DataMode {
  const mode = process.env.DATA_MODE;
  return mode === "real" || mode === "hybrid" || mode === "mock" ? mode : "mock";
}

export async function getDashboardData() {
  const mode = dataMode();
  if (mode === "mock") {
    return withRuntimeServices(new MockVenueAdapter().getDashboardData());
  }
  const now = Date.now();
  if (
    cachedRealSnapshot &&
    cachedRealSnapshot.mode === mode &&
    now - cachedRealSnapshot.createdAt < REAL_SNAPSHOT_TTL_MS
  ) {
    return cachedRealSnapshot.promise;
  }
  cachedRealSnapshot = {
    mode,
    createdAt: now,
    promise: withRuntimeServices(new RealDashboardAdapter({ mode }).getDashboardData()),
  };
  return cachedRealSnapshot.promise;
}

async function withRuntimeServices(input: Promise<DashboardData>): Promise<DashboardData> {
  const data = await input;
  const alerts = await applyAlertOperatorActions(buildAlerts(data));
  const withAlerts = { ...data, alerts };
  const persistence = await persistDashboardSnapshot(withAlerts);
  return { ...withAlerts, persistence };
}

export async function getOverview() {
  const data = await getDashboardData();
  return data.overview;
}

export async function getSurfaces() {
  const data = await getDashboardData();
  return data.surfaces;
}

export async function getOpportunities() {
  const data = await getDashboardData();
  return data.opportunities;
}

export async function getSviHealth() {
  const data = await getDashboardData();
  return data.sviHealth;
}

export async function getRiskRules() {
  const data = await getDashboardData();
  return data.riskRules;
}

export async function getSourceStatuses() {
  const data = await getDashboardData();
  return {
    mode: data.mode,
    sourceStatuses: data.sourceStatuses,
    persistence: data.persistence,
  };
}

export async function getDashboardAlerts() {
  const data = await getDashboardData();
  return data.alerts;
}

export async function getPersistenceStatus() {
  const data = await getDashboardData();
  return data.persistence;
}
