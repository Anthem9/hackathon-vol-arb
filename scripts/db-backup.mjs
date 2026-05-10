import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadLocalEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required for database backup.");
  process.exit(1);
}

const backupDir = resolve(process.env.DB_BACKUP_DIR ?? "backups");
mkdirSync(backupDir, { recursive: true });
const output = resolve(process.env.DB_BACKUP_FILE ?? `${backupDir}/volarb-${timestamp()}.dump`);

const result = spawnSync(
  "pg_dump",
  ["--format=custom", "--no-owner", "--no-privileges", "--file", output, databaseUrl],
  { stdio: ["ignore", "pipe", "pipe"] },
);

if (result.error) {
  console.error(`pg_dump failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr.toString("utf8") || "pg_dump failed.");
  process.exit(result.status ?? 1);
}

console.log(`database backup written to ${output}`);
