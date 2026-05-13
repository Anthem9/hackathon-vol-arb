#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const pidFile = resolve(root, ".local/run/btc5m-orderbook-collector.pid");
const logFile = resolve(root, ".local/logs/btc5m-orderbook-collector.log");

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

function logSizeBytes() {
  if (!existsSync(logFile)) return 0;
  return statSync(logFile).size;
}

function start() {
  ensureDirs();
  const existing = readPid();
  if (existing && isRunning(existing)) {
    console.log(JSON.stringify({ status: "already_running", pid: existing, pidFile, logFile }, null, 2));
    return;
  }
  if (existing) rmSync(pidFile, { force: true });
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
  const logFd = openSync(logFile, "a");
  const child = spawn("pnpm", args, {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  writeFileSync(pidFile, `${child.pid}\n`);
  child.unref();
  console.log(JSON.stringify({ status: "started", pid: child.pid, pidFile, logFile, args: ["pnpm", ...args] }, null, 2));
}

function stop() {
  const pid = readPid();
  if (!pid) {
    console.log(JSON.stringify({ status: "not_running", pidFile }, null, 2));
    return;
  }
  if (isRunning(pid)) process.kill(pid, "SIGTERM");
  rmSync(pidFile, { force: true });
  console.log(JSON.stringify({ status: "stopped", pid, pidFile, logFile }, null, 2));
}

function status() {
  const pid = readPid();
  console.log(
    JSON.stringify(
      {
        status: pid && isRunning(pid) ? "running" : "not_running",
        pid,
        pidFile,
        logFile,
        logSizeBytes: logSizeBytes(),
        lastLogLines: readLastLogLines(),
      },
      null,
      2,
    ),
  );
}

const command = process.argv[2] ?? "status";
if (command === "start") start();
else if (command === "stop") stop();
else if (command === "status") status();
else {
  console.error("Usage: node scripts/btc5m-orderbook-collector.mjs <start|stop|status>");
  process.exit(1);
}
