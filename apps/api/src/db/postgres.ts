import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { AlertEvent, DashboardData, DataMode, PaperTrade, PersistenceStatus } from "@vol-arb/core";

const { Pool } = pg;

let pool: pg.Pool | null = null;
let initPromise: Promise<void> | null = null;
let lastWriteAt: number | null = null;
let lastError: string | null = null;
let lastConnectionAttemptAt = 0;

const DB_RETRY_BACKOFF_MS = 3000;

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
    pool.on("error", (error: Error) => {
      lastError = error.message;
      initPromise = null;
      const brokenPool = pool;
      pool = null;
      brokenPool?.end().catch(() => undefined);
    });
  }
  return pool;
}

function resetPoolAfterFailure() {
  const brokenPool = pool;
  pool = null;
  initPromise = null;
  brokenPool?.end().catch(() => undefined);
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
  if (lastError && Date.now() - lastConnectionAttemptAt < DB_RETRY_BACKOFF_MS) {
    return null;
  }
  if (lastError) {
    resetPoolAfterFailure();
    lastError = null;
  }
  lastConnectionAttemptAt = Date.now();
  initPromise ??= migrateDatabase().catch((error: unknown) => {
    lastError = error instanceof Error ? error.message : "Unknown Postgres migration error";
    initPromise = null;
    throw error;
  });
  await initPromise;
  return getPool();
}

export async function checkDatabaseConnection(): Promise<PersistenceStatus> {
  try {
    const db = await ensureDatabase();
    if (!db) return getDatabaseStatus();
    await db.query("select 1");
    lastError = null;
    return getDatabaseStatus();
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres connection error";
    return getDatabaseStatus();
  }
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

export async function readRecentPaperTrades(limit = 50): Promise<PaperTrade[]> {
  const db = await ensureDatabase();
  if (!db) return [];
  const result = await db.query<{ payload: PaperTrade }>(
    `select payload
     from paper_trade_events
     order by created_at desc
     limit $1`,
    [limit],
  );
  return result.rows
    .map((row) => row.payload)
    .filter((row): row is PaperTrade => typeof row?.tradeId === "string" && typeof row?.opportunityId === "string");
}

export type ChainTransactionEvent = {
  digest: string;
  action: "create_manager" | "deposit_quote" | "mint_binary" | "redeem_binary" | "withdraw_quote";
  status: "submitted" | "success" | "failed";
  lifecycleStatus: "pending" | "submitted" | "confirmed" | "indexed" | "reconciled" | "failed";
  owner?: string;
  managerId?: string;
  oracleId?: string;
  expiry?: number;
  strike?: string;
  direction?: string;
  quantity?: string;
  payload: Record<string, unknown>;
  failureReason?: string;
  observedAt: number;
  confirmedAt?: number;
  indexedAt?: number;
  reconciledAt?: number;
  createdAt: number;
};

export type WalletManagerBinding = {
  network: "testnet";
  owner: string;
  managerId: string;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export type WalletMintDryRunEvent = {
  id?: number;
  network: "testnet";
  owner: string;
  managerId: string;
  oracleId: string;
  expiry: number;
  strike: string;
  direction: "up" | "down";
  quantity: string;
  status: "success" | "failed";
  dryRunDigest?: string;
  failureReason?: string;
  payload: Record<string, unknown>;
  createdAt: number;
};

export async function persistChainTransactionEvent(input: ChainTransactionEvent): Promise<PersistenceStatus> {
  try {
    const db = await ensureDatabase();
    if (!db) return getDatabaseStatus();
    await db.query(
      `insert into chain_transaction_events
        (digest, action, status, lifecycle_status, owner, manager_id, oracle_id, expiry, strike, direction, quantity, payload, failure_reason, observed_at, confirmed_at, indexed_at, reconciled_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, to_timestamp($14 / 1000.0), to_timestamp($15 / 1000.0), to_timestamp($16 / 1000.0), to_timestamp($17 / 1000.0))
       on conflict (digest) do update set
         action = excluded.action,
         status = excluded.status,
         lifecycle_status = excluded.lifecycle_status,
         owner = excluded.owner,
         manager_id = excluded.manager_id,
         oracle_id = excluded.oracle_id,
         expiry = excluded.expiry,
         strike = excluded.strike,
         direction = excluded.direction,
         quantity = excluded.quantity,
         payload = excluded.payload,
         failure_reason = excluded.failure_reason,
         observed_at = excluded.observed_at,
         confirmed_at = coalesce(excluded.confirmed_at, chain_transaction_events.confirmed_at),
         indexed_at = coalesce(excluded.indexed_at, chain_transaction_events.indexed_at),
         reconciled_at = coalesce(excluded.reconciled_at, chain_transaction_events.reconciled_at)`,
      [
        input.digest,
        input.action,
        input.status,
        input.lifecycleStatus,
        input.owner ?? null,
        input.managerId ?? null,
        input.oracleId ?? null,
        input.expiry ?? null,
        input.strike ?? null,
        input.direction ?? null,
        input.quantity ?? null,
        JSON.stringify(input.payload ?? {}),
        input.failureReason ?? null,
        input.observedAt,
        input.confirmedAt ?? null,
        input.indexedAt ?? null,
        input.reconciledAt ?? null,
      ],
    );
    lastError = null;
    lastWriteAt = Date.now();
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres chain transaction write error";
  }
  return getDatabaseStatus();
}

export async function persistWalletMintDryRunEvent(input: WalletMintDryRunEvent): Promise<{ event: WalletMintDryRunEvent; persistence: PersistenceStatus }> {
  try {
    const db = await ensureDatabase();
    if (!db) return { event: input, persistence: getDatabaseStatus() };
    const result = await db.query<{
      id: string;
      created_at: Date;
    }>(
      `insert into wallet_mint_dry_run_events
        (network, owner, manager_id, oracle_id, expiry, strike, direction, quantity, status, dry_run_digest, failure_reason, payload, created_at)
       values ('testnet', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, to_timestamp($12 / 1000.0))
       returning id, created_at`,
      [
        input.owner,
        input.managerId,
        input.oracleId,
        input.expiry,
        input.strike,
        input.direction,
        input.quantity,
        input.status,
        input.dryRunDigest ?? null,
        input.failureReason ?? null,
        JSON.stringify(input.payload ?? {}),
        input.createdAt,
      ],
    );
    lastError = null;
    lastWriteAt = Date.now();
    const row = result.rows[0];
    return {
      event: {
        ...input,
        id: Number(row.id),
        createdAt: row.created_at.getTime(),
      },
      persistence: getDatabaseStatus(),
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres wallet mint dry-run write error";
    return { event: input, persistence: getDatabaseStatus() };
  }
}

export async function readRecentWalletMintDryRunEvents(input: { owner?: string; managerId?: string; limit?: number } = {}): Promise<WalletMintDryRunEvent[]> {
  try {
    const db = await ensureDatabase();
    if (!db) return [];
    const clauses = ["network = 'testnet'"];
    const params: unknown[] = [];
    if (input.owner) {
      params.push(input.owner);
      clauses.push(`owner = $${params.length}`);
    }
    if (input.managerId) {
      params.push(input.managerId);
      clauses.push(`manager_id = $${params.length}`);
    }
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 25)));
    params.push(limit);
    const result = await db.query<{
      id: string;
      network: "testnet";
      owner: string;
      manager_id: string;
      oracle_id: string;
      expiry: string;
      strike: string;
      direction: "up" | "down";
      quantity: string;
      status: "success" | "failed";
      dry_run_digest: string | null;
      failure_reason: string | null;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `select id, network, owner, manager_id, oracle_id, expiry, strike, direction, quantity, status, dry_run_digest, failure_reason, payload, created_at
       from wallet_mint_dry_run_events
       where ${clauses.join(" and ")}
       order by created_at desc
       limit $${params.length}`,
      params,
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      network: row.network,
      owner: row.owner,
      managerId: row.manager_id,
      oracleId: row.oracle_id,
      expiry: Number(row.expiry),
      strike: row.strike,
      direction: row.direction,
      quantity: row.quantity,
      status: row.status,
      dryRunDigest: row.dry_run_digest ?? undefined,
      failureReason: row.failure_reason ?? undefined,
      payload: row.payload ?? {},
      createdAt: row.created_at.getTime(),
    }));
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres wallet mint dry-run read error";
    return [];
  }
}

export async function upsertWalletManagerBinding(input: { owner: string; managerId: string; source?: string }): Promise<WalletManagerBinding | null> {
  try {
    const db = await ensureDatabase();
    if (!db) return null;
    const result = await db.query<{
      network: "testnet";
      owner: string;
      manager_id: string;
      source: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `insert into wallet_manager_bindings (network, owner, manager_id, source)
       values ('testnet', $1, $2, $3)
       on conflict (network, owner) do update set
         manager_id = excluded.manager_id,
         source = excluded.source,
         updated_at = now()
       returning network, owner, manager_id, source, created_at, updated_at`,
      [input.owner, input.managerId, input.source ?? "wallet_ui"],
    );
    lastError = null;
    lastWriteAt = Date.now();
    const row = result.rows[0];
    return {
      network: row.network,
      owner: row.owner,
      managerId: row.manager_id,
      source: row.source,
      createdAt: row.created_at.getTime(),
      updatedAt: row.updated_at.getTime(),
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres wallet-manager binding write error";
    return null;
  }
}

export async function readWalletManagerBinding(owner: string): Promise<WalletManagerBinding | null> {
  try {
    const db = await ensureDatabase();
    if (!db) return null;
    const result = await db.query<{
      network: "testnet";
      owner: string;
      manager_id: string;
      source: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `select network, owner, manager_id, source, created_at, updated_at
       from wallet_manager_bindings
       where network = 'testnet' and owner = $1
       limit 1`,
      [owner],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      network: row.network,
      owner: row.owner,
      managerId: row.manager_id,
      source: row.source,
      createdAt: row.created_at.getTime(),
      updatedAt: row.updated_at.getTime(),
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Unknown Postgres wallet-manager binding read error";
    return null;
  }
}

export async function readRecentChainTransactionEvents(limit = 50): Promise<ChainTransactionEvent[]> {
  const db = await ensureDatabase();
  if (!db) return [];
  const result = await db.query<{
    digest: string;
    action: ChainTransactionEvent["action"];
    status: ChainTransactionEvent["status"];
    lifecycle_status: ChainTransactionEvent["lifecycleStatus"];
    owner: string | null;
    manager_id: string | null;
    oracle_id: string | null;
    expiry: string | null;
    strike: string | null;
    direction: string | null;
    quantity: string | null;
    payload: Record<string, unknown>;
    failure_reason: string | null;
    observed_at: Date;
    confirmed_at: Date | null;
    indexed_at: Date | null;
    reconciled_at: Date | null;
    created_at: Date;
  }>(
    `select digest, action, status, lifecycle_status, owner, manager_id, oracle_id, expiry, strike, direction, quantity, payload, failure_reason, observed_at, confirmed_at, indexed_at, reconciled_at, created_at
     from chain_transaction_events
     order by created_at desc
     limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({
    digest: row.digest,
    action: row.action,
    status: row.status,
    lifecycleStatus: row.lifecycle_status,
    owner: row.owner ?? undefined,
    managerId: row.manager_id ?? undefined,
    oracleId: row.oracle_id ?? undefined,
    expiry: row.expiry ? Number(row.expiry) : undefined,
    strike: row.strike ?? undefined,
    direction: row.direction ?? undefined,
    quantity: row.quantity ?? undefined,
    payload: row.payload ?? {},
    failureReason: row.failure_reason ?? undefined,
    observedAt: row.observed_at.getTime(),
    confirmedAt: row.confirmed_at?.getTime(),
    indexedAt: row.indexed_at?.getTime(),
    reconciledAt: row.reconciled_at?.getTime(),
    createdAt: row.created_at.getTime(),
  }));
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

export type AlertOperatorAction = {
  alertId: string;
  action: "resolve" | "silence";
  reason?: string;
  createdAt: number;
};

export async function recordAlertOperatorAction(input: {
  alertId: string;
  action: "resolve" | "silence";
  reason?: string;
}): Promise<AlertOperatorAction> {
  const db = await ensureDatabase();
  if (!db) {
    throw new Error("DATABASE_URL is required for alert operator actions.");
  }
  const result = await db.query<{ alert_id: string; action: "resolve" | "silence"; reason: string | null; created_at: Date }>(
    `insert into alert_operator_events (alert_id, action, reason)
     values ($1, $2, $3)
     returning alert_id, action, reason, created_at`,
    [input.alertId, input.action, input.reason ?? null],
  );
  const row = result.rows[0];
  lastError = null;
  lastWriteAt = Date.now();
  return {
    alertId: row.alert_id,
    action: row.action,
    reason: row.reason ?? undefined,
    createdAt: row.created_at.getTime(),
  };
}

export async function readLatestAlertOperatorActions(alertIds: string[]): Promise<Map<string, AlertOperatorAction>> {
  const db = await ensureDatabase();
  if (!db || alertIds.length === 0) return new Map();
  const result = await db.query<{ alert_id: string; action: "resolve" | "silence"; reason: string | null; created_at: Date }>(
    `select distinct on (alert_id) alert_id, action, reason, created_at
     from alert_operator_events
     where alert_id = any($1)
     order by alert_id, created_at desc`,
    [alertIds],
  );
  return new Map(
    result.rows.map((row) => [
      row.alert_id,
      {
        alertId: row.alert_id,
        action: row.action,
        reason: row.reason ?? undefined,
        createdAt: row.created_at.getTime(),
      },
    ]),
  );
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
