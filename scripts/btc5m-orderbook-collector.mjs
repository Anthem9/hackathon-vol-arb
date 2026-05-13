#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const pidFile = process.env.BTC5M_ORDERBOOK_PID_FILE
  ? resolve(root, process.env.BTC5M_ORDERBOOK_PID_FILE)
  : resolve(root, ".local/run/btc5m-orderbook-collector.pid");
const metaFile = process.env.BTC5M_ORDERBOOK_META_FILE
  ? resolve(root, process.env.BTC5M_ORDERBOOK_META_FILE)
  : resolve(root, ".local/run/btc5m-orderbook-collector.json");
const logFile = process.env.BTC5M_ORDERBOOK_LOG_FILE
  ? resolve(root, process.env.BTC5M_ORDERBOOK_LOG_FILE)
  : resolve(root, ".local/logs/btc5m-orderbook-collector.log");

function ensureDirs() {
  mkdirSync(dirname(pidFile), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function readLastLogLines(limit = 12) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, "utf8").trimEnd().split("\n").slice(-limit);
}

function parseProgressLine(line) {
  const match = line.match(
    /collect-orderbook-sessions session=(\d+)\/(\d+) iterations=(\d+) snapshots=(\d+) errors=(\d+) elapsed=([\d.]+)s/,
  );
  if (!match) return null;
  return {
    session: Number(match[1]),
    totalSessions: Number(match[2]),
    iterations: Number(match[3]),
    snapshots: Number(match[4]),
    errors: Number(match[5]),
    elapsedSeconds: Number(match[6]),
  };
}

function logHealth(lines) {
  const progress = lines.map(parseProgressLine).filter(Boolean);
  const latestProgress = progress.at(-1) ?? null;
  const recentErrorLines = progress.filter((line) => line.errors > 0).length;
  const health = recentErrorLines === 0 ? "healthy" : latestProgress?.errors === 0 ? "recovering" : "warning";
  return {
    health,
    latestProgress,
    recentProgressLines: progress.length,
    recentErrorLines,
  };
}

function logStats() {
  if (!existsSync(logFile)) {
    return {
      sizeBytes: 0,
      updatedAt: null,
      ageSeconds: null,
    };
  }
  const stats = statSync(logFile);
  return {
    sizeBytes: stats.size,
    updatedAt: stats.mtime.toISOString(),
    ageSeconds: Math.max(0, (Date.now() - stats.mtime.getTime()) / 1000),
  };
}

function readMeta() {
  if (!existsSync(metaFile)) return null;
  try {
    return JSON.parse(readFileSync(metaFile, "utf8"));
  } catch {
    return null;
  }
}

function useCaffeinate() {
  return process.platform === "darwin" && process.env.BTC5M_ORDERBOOK_CAFFEINATE !== "false";
}

function autoTargetSegments() {
  const coverage = readCoverage();
  const segments = Array.isArray(coverage.weakestOrderbookSegments) ? coverage.weakestOrderbookSegments.map((segment) => segment.segment).filter(Boolean) : [];
  return segments.slice(0, Math.max(1, Number(process.env.BTC5M_ORDERBOOK_AUTO_TARGET_COUNT ?? "2")));
}

function readCoverage() {
  const result = spawnSync("pnpm", ["--silent", "--filter", "@vol-arb/api", "btc5m:research", "coverage", "--days", process.env.BTC5M_ORDERBOOK_COVERAGE_DAYS ?? "7"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to inspect BTC 5m coverage for auto target segments: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function start(options = {}) {
  ensureDirs();
  const existing = readPid();
  if (existing && isRunning(existing)) {
    console.log(JSON.stringify({ status: "already_running", pid: existing, pidFile, metaFile, logFile, meta: readMeta() }, null, 2));
    return;
  }
  if (existing) rmSync(pidFile, { force: true });
  const targetSegments = process.env.BTC5M_ORDERBOOK_TARGET_SEGMENTS || (options.autoTarget ? autoTargetSegments().join(",") : "");
  const args = [
    "--filter",
    "@vol-arb/api",
    "btc5m:research",
    "collect-orderbook-sessions",
    "--sessions",
    process.env.BTC5M_ORDERBOOK_SESSIONS ?? "192",
    "--duration-seconds",
    process.env.BTC5M_ORDERBOOK_DURATION_SECONDS ?? "300",
    "--interval-ms",
    process.env.BTC5M_ORDERBOOK_INTERVAL_MS ?? "1000",
    "--pause-seconds",
    process.env.BTC5M_ORDERBOOK_PAUSE_SECONDS ?? "5",
    "--progress-every",
    process.env.BTC5M_ORDERBOOK_PROGRESS_EVERY ?? "60",
  ];
  if (targetSegments) {
    args.push("--target-segments", targetSegments);
    if (process.env.BTC5M_ORDERBOOK_WAIT_FOR_TARGET_SEGMENT !== "false") {
      args.push("--wait-for-target-segment");
      args.push("--target-segment-check-seconds", process.env.BTC5M_ORDERBOOK_TARGET_SEGMENT_CHECK_SECONDS ?? "60");
    }
  }
  const command = useCaffeinate() ? "caffeinate" : "pnpm";
  const commandArgs = useCaffeinate() ? ["-dimsu", "pnpm", ...args] : args;
  const logFd = openSync(logFile, "a");
  const child = spawn(command, commandArgs, {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  writeFileSync(pidFile, `${child.pid}\n`);
  const meta = {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    caffeinate: useCaffeinate(),
    autoTarget: Boolean(options.autoTarget),
    targetSegments: targetSegments ? targetSegments.split(",").map((segment) => segment.trim()).filter(Boolean) : [],
    command,
    args: commandArgs,
  };
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  child.unref();
  console.log(JSON.stringify({ status: "started", pid: child.pid, pidFile, metaFile, logFile, meta }, null, 2));
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log(JSON.stringify({ status: "not_running", pidFile }, null, 2));
    return;
  }
  if (isRunning(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
  rmSync(pidFile, { force: true });
  rmSync(metaFile, { force: true });
  console.log(JSON.stringify({ status: "stopped", pid, pidFile, metaFile, logFile }, null, 2));
}

function status() {
  const pid = readPid();
  const meta = readMeta();
  const lastLogLines = readLastLogLines();
  const running = Boolean(pid && isRunning(pid));
  const health = logHealth(lastLogLines);
  const stats = logStats();
  console.log(
    JSON.stringify(
      {
        status: running ? "running" : "not_running",
        pid,
        pidFile,
        metaFile,
        logFile,
        configuredCaffeinate: useCaffeinate(),
        launchCaffeinate: meta?.pid === pid ? meta.caffeinate : null,
        meta,
        logSizeBytes: stats.sizeBytes,
        logUpdatedAt: stats.updatedAt,
        logAgeSeconds: stats.ageSeconds,
        logHealth: health,
        lastLogLines,
      },
      null,
      2,
    ),
  );
}

function health() {
  const pid = readPid();
  const meta = readMeta();
  const lastLogLines = readLastLogLines();
  const running = Boolean(pid && isRunning(pid));
  const health = logHealth(lastLogLines);
  const stats = logStats();
  const maxLogAgeSeconds = Number(process.env.BTC5M_ORDERBOOK_HEALTH_MAX_LOG_AGE_SECONDS ?? "180");
  console.log(
    JSON.stringify(
      {
        status: running ? "running" : "not_running",
        pid,
        logFile,
        launchCaffeinate: meta?.pid === pid ? meta.caffeinate : null,
        logUpdatedAt: stats.updatedAt,
        logAgeSeconds: stats.ageSeconds,
        maxLogAgeSeconds,
        logHealth: health,
      },
      null,
      2,
    ),
  );
  if (process.argv.includes("--require-ok")) {
    if (!running) process.exitCode = 2;
    else if (!health.latestProgress) process.exitCode = 3;
    else if (health.health === "warning") process.exitCode = 4;
    else if (Number.isFinite(maxLogAgeSeconds) && stats.ageSeconds !== null && stats.ageSeconds > maxLogAgeSeconds) process.exitCode = 5;
  }
}

function plan() {
  const pid = readPid();
  const meta = readMeta();
  const running = Boolean(pid && isRunning(pid));
  const coverage = readCoverage();
  const weakestSegments = Array.isArray(coverage.weakestOrderbookSegments) ? coverage.weakestOrderbookSegments.map((segment) => segment.segment).filter(Boolean) : [];
  const targetSegments = meta?.pid === pid && Array.isArray(meta.targetSegments) ? meta.targetSegments : [];
  const runningTargetsWeakSegments = targetSegments.length > 0 && weakestSegments.every((segment) => targetSegments.includes(segment));
  const activeCollectorIsUntargeted = running && targetSegments.length === 0;
  const suggestedTargetSegments = weakestSegments.slice(0, Math.max(1, Number(process.env.BTC5M_ORDERBOOK_AUTO_TARGET_COUNT ?? "2")));
  const nextWeakSegment = coverage.nextWeakSegmentWindows?.[0]?.segment ?? null;
  const canCaptureNextWeakWindow = running && (activeCollectorIsUntargeted || (nextWeakSegment ? targetSegments.includes(nextWeakSegment) : runningTargetsWeakSegments));
  const recommendedAction = !running
    ? "start_auto_targeted_collector"
    : canCaptureNextWeakWindow
      ? "keep_current_collector_running"
      : "switch_to_auto_targeted_collector";
  console.log(
    JSON.stringify(
      {
        status: running ? "running" : "not_running",
        pid,
        coverage: {
          days: coverage.days,
          executionQuality: coverage.executionQuality,
          markets: coverage.markets,
          marketsWithTrades: coverage.marketsWithTrades,
          marketsWithOrderbook: coverage.marketsWithOrderbook,
          orderbookMarketCoverage: coverage.orderbookMarketCoverage,
          readyForGeneticSearch: coverage.readyForGeneticSearch,
          orderbookTargets: coverage.orderbookTargets,
          currentBeijingSegment: coverage.currentBeijingSegment,
          currentSegmentCoverage: coverage.currentSegmentCoverage,
          weakestOrderbookSegments: coverage.weakestOrderbookSegments,
          nextWeakSegmentWindows: coverage.nextWeakSegmentWindows,
          collectionRecommendation: coverage.collectionRecommendation,
        },
        runningCollector: {
          targetSegments,
          autoTarget: meta?.autoTarget ?? false,
          caffeinate: meta?.caffeinate ?? null,
          command: meta?.command ?? null,
        },
        plan: {
          recommendedAction,
          suggestedTargetSegments,
          canCaptureNextWeakWindow,
          runningTargetsWeakSegments,
          activeCollectorIsUntargeted,
          startAutoCommand: "pnpm btc5m:orderbook:start:auto",
          switchToAutoTargetCommand: running ? "pnpm btc5m:orderbook:stop && pnpm btc5m:orderbook:start:auto" : "pnpm btc5m:orderbook:start:auto",
          statusCommand: "pnpm btc5m:orderbook:status",
          coverageCommand: "pnpm --filter @vol-arb/api btc5m:research coverage --days 7",
        },
      },
      null,
      2,
    ),
  );
}

const command = process.argv[2] ?? "status";
if (command === "start") start();
else if (command === "start-auto") start({ autoTarget: true });
else if (command === "stop") stop();
else if (command === "status") status();
else if (command === "health") health();
else if (command === "plan") plan();
else {
  console.error("Usage: node scripts/btc5m-orderbook-collector.mjs <start|start-auto|stop|status|health|plan>");
  process.exit(1);
}
