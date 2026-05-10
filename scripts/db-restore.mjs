import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

loadLocalEnv();

const databaseUrl = process.env.DATABASE_URL;
const restoreFile = process.argv[2] ?? process.env.DB_RESTORE_FILE;

if (!databaseUrl) {
  console.error("DATABASE_URL is required for database restore.");
  process.exit(1);
}
if (!restoreFile) {
  console.error("Usage: CONFIRM_RESTORE=volarb npm run db:restore -- backups/<file>.dump");
  process.exit(1);
}
if (process.env.CONFIRM_RESTORE !== "volarb") {
  console.error("Refusing to restore without CONFIRM_RESTORE=volarb.");
  process.exit(1);
}

const input = resolve(restoreFile);
if (!existsSync(input)) {
  console.error(`Restore file does not exist: ${input}`);
  process.exit(1);
}

const result = spawnSync(
  "pg_restore",
  ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", databaseUrl, input],
  { stdio: ["ignore", "pipe", "pipe"] },
);

if (result.error) {
  console.error(`pg_restore failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr.toString("utf8") || "pg_restore failed.");
  process.exit(result.status ?? 1);
}

console.log(`database restored from ${input}`);
