import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

  function runCollector(command, lines, expectedStatus = 0) {
    writeFileSync(logFile, `${lines.join("\n")}\n`);
    const args = ["scripts/btc5m-orderbook-collector.mjs", ...command.split(" ")];
    const result = spawnSync("node", args, {
      encoding: "utf8",
      env: {
        ...process.env,
        BTC5M_ORDERBOOK_PID_FILE: pidFile,
        BTC5M_ORDERBOOK_META_FILE: metaFile,
        BTC5M_ORDERBOOK_LOG_FILE: logFile,
      },
    });
    assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  }

  const recoveringLines = [
    "collect-orderbook-sessions session=1/3 starting",
    "collect-orderbook-sessions session=1/3 iterations=60 snapshots=120 errors=0 elapsed=60.1s",
    "collect-orderbook-sessions session=1/3 iterations=120 snapshots=239 errors=1 elapsed=125.3s",
    "collect-orderbook-sessions session=2/3 iterations=1 snapshots=2 errors=0 elapsed=1.4s",
  ];
  const status = runCollector("status", recoveringLines);
  assert.equal(status.status, "not_running");
  assert.equal(status.logHealth.health, "recovering");
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
  assert.ok(Array.isArray(status.lastLogLines));

  const health = runCollector("health", recoveringLines);
  assert.equal(health.logHealth.health, "recovering");
  assert.equal(health.lastLogLines, undefined);
  assert.ok(health.logUpdatedAt);
  assert.equal(typeof health.logAgeSeconds, "number");
  writeFileSync(pidFile, `${process.pid}\n`);
  writeFileSync(metaFile, `${JSON.stringify({ pid: process.pid, caffeinate: true, command: "test" })}\n`);
  assert.equal(runCollector("health --require-ok", recoveringLines).logHealth.health, "recovering");

  const healthyStatus = runCollector("status", [
    "collect-orderbook-sessions session=2/3 iterations=60 snapshots=120 errors=0 elapsed=60.1s",
    "collect-orderbook-sessions session=2/3 iterations=120 snapshots=240 errors=0 elapsed=120.1s",
  ]);
  assert.equal(healthyStatus.logHealth.health, "healthy");
  assert.equal(healthyStatus.logHealth.recentErrorLines, 0);

  const warningStatus = runCollector("status", [
    "collect-orderbook-sessions session=2/3 iterations=60 snapshots=120 errors=0 elapsed=60.1s",
    "collect-orderbook-sessions session=2/3 iterations=120 snapshots=239 errors=1 elapsed=125.3s",
  ]);
  assert.equal(warningStatus.logHealth.health, "warning");
  assert.equal(warningStatus.logHealth.latestProgress.errors, 1);
  const warningHealth = runCollector(
    "health --require-ok",
    [
      "collect-orderbook-sessions session=2/3 iterations=60 snapshots=120 errors=0 elapsed=60.1s",
      "collect-orderbook-sessions session=2/3 iterations=120 snapshots=239 errors=1 elapsed=125.3s",
    ],
    4,
  );
  assert.equal(warningHealth.logHealth.health, "warning");

  runCollector("health --require-ok", healthyStatus.lastLogLines, 0);
  const staleDate = new Date(Date.now() - 10_000);
  utimesSync(logFile, staleDate, staleDate);
  const staleResult = spawnSync("node", ["scripts/btc5m-orderbook-collector.mjs", "health", "--require-ok"], {
    encoding: "utf8",
    env: {
      ...process.env,
      BTC5M_ORDERBOOK_PID_FILE: pidFile,
      BTC5M_ORDERBOOK_META_FILE: metaFile,
      BTC5M_ORDERBOOK_LOG_FILE: logFile,
      BTC5M_ORDERBOOK_HEALTH_MAX_LOG_AGE_SECONDS: "1",
    },
  });
  assert.equal(staleResult.status, 5, staleResult.stderr || staleResult.stdout);
  assert.ok(JSON.parse(staleResult.stdout).logAgeSeconds > 1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("btc5m-orderbook-collector status tests passed");
