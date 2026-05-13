import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDir = mkdtempSync(join(tmpdir(), "btc5m-orderbook-status-"));
try {
  const runDir = join(tempDir, "run");
  const logDir = join(tempDir, "logs");
  mkdirSync(runDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  const pidFile = join(runDir, "collector.pid");
  const metaFile = join(runDir, "collector.json");
  const logFile = join(logDir, "collector.log");

  writeFileSync(pidFile, "999999\n");
  writeFileSync(metaFile, `${JSON.stringify({ pid: 999999, caffeinate: true, command: "test" })}\n`);
  writeFileSync(
    logFile,
    [
      "collect-orderbook-sessions session=1/3 starting",
      "collect-orderbook-sessions session=1/3 iterations=60 snapshots=120 errors=0 elapsed=60.1s",
      "collect-orderbook-sessions session=1/3 iterations=120 snapshots=239 errors=1 elapsed=125.3s",
      "collect-orderbook-sessions session=2/3 iterations=1 snapshots=2 errors=0 elapsed=1.4s",
    ].join("\n") + "\n",
  );

  const result = spawnSync("node", ["scripts/btc5m-orderbook-collector.mjs", "status"], {
    encoding: "utf8",
    env: {
      ...process.env,
      BTC5M_ORDERBOOK_PID_FILE: pidFile,
      BTC5M_ORDERBOOK_META_FILE: metaFile,
      BTC5M_ORDERBOOK_LOG_FILE: logFile,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const status = JSON.parse(result.stdout);
  assert.equal(status.status, "not_running");
  assert.equal(status.logHealth.health, "warning");
  assert.equal(status.logHealth.recentProgressLines, 3);
  assert.equal(status.logHealth.recentErrorLines, 1);
  assert.deepEqual(status.logHealth.latestProgress, {
    session: 2,
    totalSessions: 3,
    iterations: 1,
    snapshots: 2,
    errors: 0,
    elapsedSeconds: 1.4,
  });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("btc5m-orderbook-collector status tests passed");
