import { checkDatabaseConnection } from "../db/postgres";
import {
  backfillDeepBookChainTransactions,
  getDeepBookChainTransactions,
  getDeepBookTestnetReadiness,
  reconcileRecentDeepBookChainTransactions,
} from "./deepbook-transaction-service";
import { getSourceStatuses } from "./dashboard-service";

type MaintenanceRun = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "success" | "partial" | "failed";
  tasks: Array<{
    name: string;
    status: "success" | "skipped" | "failed";
    detail: string;
    startedAt: number;
    finishedAt: number;
  }>;
};

let lastRun: MaintenanceRun | null = null;
let currentRun: Promise<MaintenanceRun> | null = null;
let schedulerStarted = false;
let scheduler: NodeJS.Timeout | null = null;

function configuredAddress() {
  return process.env.SUI_TESTNET_ADDRESS?.trim() || undefined;
}

function maintenanceIntervalMs() {
  const value = Number(process.env.MAINTENANCE_INTERVAL_MS ?? 60_000);
  return Number.isFinite(value) ? Math.max(15_000, Math.trunc(value)) : 60_000;
}

function maintenanceTaskTimeoutMs() {
  const value = Number(process.env.MAINTENANCE_TASK_TIMEOUT_MS ?? 20_000);
  return Number.isFinite(value) ? Math.max(5_000, Math.trunc(value)) : 20_000;
}

async function withTaskTimeout(name: string, task: () => Promise<string>) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      task(),
      new Promise<string>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${name} timed out after ${maintenanceTaskTimeoutMs()}ms`)), maintenanceTaskTimeoutMs());
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runTask(name: string, task: () => Promise<string>) {
  const startedAt = Date.now();
  try {
    const detail = await withTaskTimeout(name, task);
    return { name, status: "success" as const, detail, startedAt, finishedAt: Date.now() };
  } catch (error) {
    return {
      name,
      status: "failed" as const,
      detail: error instanceof Error ? error.message : "Unknown maintenance failure",
      startedAt,
      finishedAt: Date.now(),
    };
  }
}

export async function runMaintenanceOnce() {
  if (currentRun) return currentRun;

  currentRun = (async () => {
    const run: MaintenanceRun = {
      id: `maint-${Date.now()}`,
      startedAt: Date.now(),
      finishedAt: null,
      status: "running",
      tasks: [],
    };
    lastRun = run;

    run.tasks.push(
      await runTask("database_check", async () => {
        const status = await checkDatabaseConnection();
        return status.enabled ? `${status.status}: ${status.detail}` : `skipped: ${status.detail}`;
      }),
    );

    run.tasks.push(
      await runTask("source_status_refresh", async () => {
        const status = await getSourceStatuses();
        const unhealthy = status.sourceStatuses.filter((source) => source.status !== "healthy");
        return unhealthy.length > 0
          ? `${unhealthy.length} source(s) degraded: ${unhealthy.map((source) => source.sourceId).join(", ")}`
          : "all sources healthy";
      }),
    );

    run.tasks.push(
      await runTask("deepbook_readiness", async () => {
        const readiness = await getDeepBookTestnetReadiness();
        return readiness.readiness.blockers.length > 0
          ? `${readiness.readiness.blockers.length} blocker(s): ${readiness.readiness.blockers.join("; ")}`
          : readiness.readiness.nextAction;
      }),
    );

    run.tasks.push(
      await runTask("deepbook_reconcile", async () => {
        const result = await reconcileRecentDeepBookChainTransactions(10);
        return `reconciled ${result.reconciled.length}; errors ${result.errors.length}`;
      }),
    );

    run.tasks.push(
      await runTask("deepbook_backfill", async () => {
        const owner = configuredAddress();
        if (!owner) return "skipped: SUI_TESTNET_ADDRESS is not configured";
        const result = await backfillDeepBookChainTransactions(owner, 25);
        return `recovered ${result.recovered.length}; skipped ${result.skipped.length}`;
      }),
    );

    run.tasks.push(
      await runTask("chain_record_summary", async () => {
        const transactions = await getDeepBookChainTransactions(25);
        const unresolved = transactions.filter((event) => event.lifecycleStatus !== "failed" && event.lifecycleStatus !== "reconciled");
        return `${transactions.length} recorded; ${unresolved.length} unresolved`;
      }),
    );

    const failed = run.tasks.filter((task) => task.status === "failed");
    run.finishedAt = Date.now();
    run.status = failed.length === 0 ? "success" : failed.length === run.tasks.length ? "failed" : "partial";
    lastRun = run;
    currentRun = null;
    return run;
  })();

  return currentRun;
}

export function getMaintenanceStatus() {
  return {
    schedulerEnabled: process.env.ENABLE_MAINTENANCE_SCHEDULER === "true",
    schedulerStarted,
    intervalMs: maintenanceIntervalMs(),
    taskTimeoutMs: maintenanceTaskTimeoutMs(),
    running: Boolean(currentRun),
    lastRun,
  };
}

export function startMaintenanceScheduler() {
  if (schedulerStarted) return getMaintenanceStatus();
  schedulerStarted = true;
  if (process.env.ENABLE_MAINTENANCE_SCHEDULER !== "true") return getMaintenanceStatus();
  scheduler = setInterval(() => {
    runMaintenanceOnce().catch((error) => {
      lastRun = {
        id: `maint-${Date.now()}`,
        startedAt: Date.now(),
        finishedAt: Date.now(),
        status: "failed",
        tasks: [
          {
            name: "scheduler",
            status: "failed",
            detail: error instanceof Error ? error.message : "Unknown scheduler failure",
            startedAt: Date.now(),
            finishedAt: Date.now(),
          },
        ],
      };
    });
  }, maintenanceIntervalMs());
  scheduler.unref();
  return getMaintenanceStatus();
}
