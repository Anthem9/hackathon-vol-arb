#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

function runJson(command, args, timeout = 120_000) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}

function runText(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function reportPath() {
  const explicit = process.env.BTC5M_CHECKPOINT_REPORT_FILE;
  if (explicit) return resolve(root, explicit);
  return resolve(root, ".local/reports", `btc5m-checkpoint-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

const days = process.env.BTC5M_CHECKPOINT_DAYS ?? "7";
const limitMarkets = process.env.BTC5M_CHECKPOINT_LIMIT_MARKETS ?? "2016";
const generations = process.env.BTC5M_CHECKPOINT_GENERATIONS ?? "1";
const population = process.env.BTC5M_CHECKPOINT_POPULATION ?? "4";
const seed = process.env.BTC5M_CHECKPOINT_SEED ?? "7";

const orderbookPlan = runJson("pnpm", ["--silent", "btc5m:orderbook:plan"]);
const readiness = runJson(
  "pnpm",
  [
    "--silent",
    "--filter",
    "@vol-arb/api",
    "btc5m:research",
    "readiness",
    "--days",
    days,
    "--limit-markets",
    limitMarkets,
    "--with-ga",
    "--generations",
    generations,
    "--population",
    population,
    "--seed",
    seed,
  ],
  180_000,
);

const output = {
  generatedAt: new Date().toISOString(),
  git: {
    head: runText("git", ["rev-parse", "HEAD"]),
    shortHead: runText("git", ["rev-parse", "--short", "HEAD"]),
    dirty: Boolean(runText("git", ["status", "--short"])),
  },
  runtime: {
    node: process.version,
    pnpm: runText("pnpm", ["--version"]),
  },
  inputs: {
    days: Number(days),
    limitMarkets: Number(limitMarkets),
    generations: Number(generations),
    population: Number(population),
    seed: Number(seed),
  },
  summary: {
    liveReady: Boolean(readiness.liveReady),
    recommendedAction: readiness.liveReady ? "review_reports_before_live_operation" : orderbookPlan.plan?.recommendedAction,
    failedChecks: readiness.failedChecks ?? [],
    notEvaluatedChecks: readiness.notEvaluatedChecks ?? [],
    executionQuality: orderbookPlan.coverage?.executionQuality ?? readiness.coverageSummary?.executionQuality ?? null,
    marketsWithOrderbook: orderbookPlan.coverage?.marketsWithOrderbook ?? readiness.coverageSummary?.marketsWithOrderbook ?? null,
    orderbookMarketCoverage: orderbookPlan.coverage?.orderbookMarketCoverage ?? null,
    marketsUntilPartialOrderbook: orderbookPlan.coverage?.orderbookTargets?.marketsUntilPartialOrderbook ?? null,
    currentBeijingSegment: orderbookPlan.coverage?.currentBeijingSegment ?? null,
    weakestOrderbookSegments: orderbookPlan.coverage?.weakestOrderbookSegments ?? readiness.coverageSummary?.weakestOrderbookSegments ?? [],
  },
  orderbookPlan,
  readiness,
  liveReady: Boolean(readiness.liveReady),
  recommendedAction: readiness.liveReady ? "review_reports_before_live_operation" : orderbookPlan.plan?.recommendedAction,
  failedChecks: readiness.failedChecks ?? [],
  notEvaluatedChecks: readiness.notEvaluatedChecks ?? [],
};

const filePath = reportPath();
mkdirSync(dirname(filePath), { recursive: true });
writeFileSync(filePath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ...output, reportFile: filePath }, null, 2));
