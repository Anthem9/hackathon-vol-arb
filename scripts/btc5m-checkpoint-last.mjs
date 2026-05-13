#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

function usage() {
  return `Usage:
  pnpm btc5m:checkpoint:last [--full] [--require-current]

Reads the most recent local BTC 5m checkpoint report from .local/reports without
running coverage, readiness, GA, network calls, or orderbook collection.

Environment overrides:
  BTC5M_CHECKPOINT_REPORT_DIR=.local/reports
`;
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(usage());
  process.exit(0);
}

const full = process.argv.includes("--full");
const requireCurrent = process.argv.includes("--require-current");
const reportsDir = process.env.BTC5M_CHECKPOINT_REPORT_DIR
  ? resolve(root, process.env.BTC5M_CHECKPOINT_REPORT_DIR)
  : resolve(root, ".local/reports");

function runText(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

if (!existsSync(reportsDir)) {
  throw new Error("No .local/reports directory exists. Run pnpm btc5m:checkpoint:status or pnpm btc5m:checkpoint first.");
}

const candidates = readdirSync(reportsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /^btc5m-checkpoint-.+\.json$/.test(entry.name))
  .map((entry) => {
    const path = resolve(reportsDir, entry.name);
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    const generatedAt = Date.parse(parsed.generatedAt ?? "");
    return { path, generatedAt, parsed };
  })
  .filter((entry) => Number.isFinite(entry.generatedAt))
  .sort((left, right) => right.generatedAt - left.generatedAt);

if (candidates.length === 0) {
  throw new Error("No BTC 5m checkpoint report files were found under .local/reports.");
}

const latest = candidates[0];
const currentGit = {
  head: runText("git", ["rev-parse", "HEAD"]),
  shortHead: runText("git", ["rev-parse", "--short", "HEAD"]),
  dirty: Boolean(runText("git", ["status", "--short"])),
};
const reportMatchesCurrentHead = Boolean(latest.parsed.git?.head && latest.parsed.git.head === currentGit.head && !currentGit.dirty);
const output = full
  ? {
      ...latest.parsed,
      currentGit,
      reportMatchesCurrentHead,
    }
  : {
      generatedAt: latest.parsed.generatedAt,
      reportFile: latest.path,
      git: latest.parsed.git,
      currentGit,
      reportMatchesCurrentHead,
      runtime: latest.parsed.runtime,
      inputs: latest.parsed.inputs,
      summary: latest.parsed.summary,
      liveReady: latest.parsed.liveReady,
      recommendedAction: latest.parsed.recommendedAction,
      failedChecks: latest.parsed.failedChecks,
      notEvaluatedChecks: latest.parsed.notEvaluatedChecks,
    };

console.log(JSON.stringify(output, null, 2));
if (requireCurrent && !reportMatchesCurrentHead) {
  process.exitCode = 2;
}
