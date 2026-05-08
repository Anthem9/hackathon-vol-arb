import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { AlertEvent, DashboardData, DataMode, PersistenceStatus } from "@vol-arb/core";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let initPromise: Promise<void> | null = null;
let lastWriteAt: number | null = null;
let lastError: string | null = null;

loadLocalEnv();

function loadLocalEnv() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(currentDir, "../../../../.env"),
    join(process.cwd(), ".env"),
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function databaseUrl() {
  return process.env.DATABASE_URL;
}

export function getDatabaseStatus(): PersistenceStatus {
  if (!databaseUrl()) {
    return {
      enabled: false,
      status: "warning",
      detail: "DATABASE_URL is not configured; Postgres persistence is disabled.",
      lastWriteAt,
    };
  }
  if (lastError) {
    return {
      enabled: true,
      status: "critical",
      detail: lastError,
      lastWriteAt,
    };
  }
  return {
    enabled: true,
    status: lastWriteAt ? "healthy" : "warning",
    detail: lastWriteAt ? "Postgres persistence is writing dashboard and alert snapshots." : "Postgres configured; waiting for first write.",
    lastWriteAt,
  };
}

function getPool() {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 2_000,
    });
  }
  return pool;
}

export async function migrateDatabase() {
  const db = getPool();
  if (!db) return;
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  const schema = await readFile(schemaPath, "utf8");
  await db.query(schema);
}

async function ensureDatabase() {
  if (!databaseUrl()) return null;
  initPromise ??= migrateDatabase().catch((error: unknown) => {
    lastError = error instanceof Error ? error.message : "Unknown Postgres migration error";
    throw error;
  });
  await initPromise;
  return getPool();
}

export async function persistDashboardSnapshot(data: DashboardData): Promise<PersistenceStatus> {
  try {
    const db = await ensureDatabase();
    if (!db) return getDatabaseStatus();
    const client = await db.connect();
    try {
      await client.query("begin");
      const snapshot = await client.query<{ id: string }>(
        `insert into dashboard_snapshots (mode, system_status, btc_spot, payload)
         values ($1, $2, $3, $4)
         returning id`,
        [data.mode, data.overview.systemStatus, data.overview.btcSpot, JSON.stringify(data)],
      );
      const snapshotId = snapshot.rows[0]?.id;
      for (const source of data.sourceStatuses) {
        await client.query(
          `insert into source_status_snapshots
            (snapshot_id, source_id, label, status, mode, latency_ms, detail, error)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            snapshotId,
            source.sourceId,
            source.label,
            source.status,
            source.mode,
            source.latencyMs ?? null,
            source.detail,
            source.error ?? null,
          ],
        );
      }
      for (const alert of data.alerts) {
        await upsertAlert(client, alert);
      }
      await client.query("commit");
      lastError = null;
      lastWriteAt = Date.now();
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres write error";
  }
  return getDatabaseStatus();
}

export async function persistPaperTradeEvent(payload: Record<string, unknown>) {
  try {
    const db = await ensureDatabase();
    if (!db) return getDatabaseStatus();
    await db.query(
      `insert into paper_trade_events (trade_id, opportunity_id, status, payload)
       values ($1, $2, $3, $4)`,
      [
        String(payload.tradeId ?? "unknown"),
        String(payload.opportunityId ?? "unknown"),
        String(payload.status ?? "unknown"),
        JSON.stringify(payload),
      ],
    );
    lastError = null;
    lastWriteAt = Date.now();
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres paper-trade write error";
  }
  return getDatabaseStatus();
}

export async function readRecentAlerts(limit = 50): Promise<AlertEvent[]> {
  const db = await ensureDatabase();
  if (!db) return [];
  const result = await db.query<{
    alert_id: string;
    rule_id: string;
    title: string;
    message: string;
    severity: AlertEvent["severity"];
    status: AlertEvent["status"];
    source_id: string;
    metadata: Record<string, unknown>;
    created_at: Date;
    resolved_at: Date | null;
  }>(
    `select alert_id, rule_id, title, message, severity, status, source_id, metadata, created_at, resolved_at
     from alert_events
     order by created_at desc
     limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    alertId: row.alert_id,
    ruleId: row.rule_id,
    title: row.title,
    message: row.message,
    severity: row.severity,
    status: row.status,
    sourceId: row.source_id,
    metadata: row.metadata,
    createdAt: row.created_at.getTime(),
    resolvedAt: row.resolved_at?.getTime(),
  }));
}

async function upsertAlert(client: pg.PoolClient, alert: AlertEvent) {
  await client.query(
    `insert into alert_events
      (alert_id, rule_id, title, message, severity, status, source_id, metadata, created_at, resolved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9 / 1000.0), $10)
     on conflict (alert_id) do update set
       title = excluded.title,
       message = excluded.message,
       severity = excluded.severity,
       status = excluded.status,
       metadata = excluded.metadata,
       resolved_at = excluded.resolved_at`,
    [
      alert.alertId,
      alert.ruleId,
      alert.title,
      alert.message,
      alert.severity,
      alert.status,
      alert.sourceId,
      JSON.stringify(alert.metadata ?? {}),
      alert.createdAt,
      alert.resolvedAt ? new Date(alert.resolvedAt) : null,
    ],
  );
}

export async function closeDatabase() {
  await pool?.end();
  pool = null;
  initPromise = null;
}

export function databaseModeForTest(): DataMode {
  return process.env.DATA_MODE === "real" ? "real" : process.env.DATA_MODE === "hybrid" ? "hybrid" : "mock";
}
