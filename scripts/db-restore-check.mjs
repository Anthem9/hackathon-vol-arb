import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const restoreFile = process.argv.slice(2).find((arg) => arg !== "--") ?? process.env.DB_RESTORE_FILE;

if (!restoreFile) {
  console.error("Usage: npm run db:restore:check -- backups/<file>.dump");
  process.exit(1);
}

const input = resolve(restoreFile);
if (!existsSync(input)) {
  console.error(`Restore file does not exist: ${input}`);
  process.exit(1);
}

const result = spawnSync("pg_restore", ["--list", input], { stdio: ["ignore", "pipe", "pipe"] });

if (result.error) {
  console.error(`pg_restore --list failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr.toString("utf8") || "pg_restore --list failed.");
  process.exit(result.status ?? 1);
}

const entries = result.stdout
  .toString("utf8")
  .split(/\r?\n/)
  .filter((line) => line.trim() && !line.startsWith(";")).length;

console.log(`database restore check passed for ${input}; ${entries} archive entries`);
