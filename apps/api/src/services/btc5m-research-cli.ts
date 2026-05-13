import {
  collectAuxiliaryBtcOneMinute,
  collectBtc5mPriceHistory,
  collectBtc5mTrades,
  collectCurrentOrderbookSnapshots,
  collectLiveOrderbookSnapshots,
  evaluateLatestBtc5mPaperSignal,
  evaluateResolvedPaperSignals,
  getBtc5mResearchCoverage,
  observeLiveBtc5m,
  summarizePaperSignals,
  collectRecentBtc5mMarkets,
  DEFAULT_BACKTEST_PARAMS,
  discoverBtc5mDataSources,
  runBtc5mBacktest,
  runBtc5mGeneticSearch,
} from "./btc5m-research-service";
import { closeDatabase } from "../db/postgres";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

type Args = Record<string, string | boolean>;
const workspaceRoot = resolve(new URL("../../../..", import.meta.url).pathname);

function parseArgs(argv: string[]) {
  const [command = "help", ...rest] = argv;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

function numberArg(args: Args, key: string, fallback: number) {
  const value = args[key];
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolArg(args: Args, key: string) {
  return args[key] === true || args[key] === "true";
}

function usage() {
  return `Usage:
  pnpm --filter @vol-arb/api btc5m:research probe
  pnpm --filter @vol-arb/api btc5m:research collect-markets --days 7 --limit 2016
  pnpm --filter @vol-arb/api btc5m:research refresh-results --days 7 --limit 2016
  pnpm --filter @vol-arb/api btc5m:research collect-price-history --days 7 --limit-markets 2016
  pnpm --filter @vol-arb/api btc5m:research collect-trades --days 7 --limit-markets 2016 --pages-per-market 2 [--stride 1] [--missing-only]
  pnpm --filter @vol-arb/api btc5m:research collect-btc-price --days 7
  pnpm --filter @vol-arb/api btc5m:research snapshot-orderbook
  pnpm --filter @vol-arb/api btc5m:research collect-orderbook-live --duration-seconds 3600 --interval-ms 1000
  pnpm --filter @vol-arb/api btc5m:research collect-orderbook-sessions --sessions 12 --duration-seconds 300 --interval-ms 1000 --pause-seconds 5 [--target-segments weekday_beijing_day,weekend_beijing_night] [--wait-for-target-segment]
  pnpm --filter @vol-arb/api btc5m:research observe-live --duration-seconds 3600 --interval-ms 1000
  pnpm --filter @vol-arb/api btc5m:research coverage --days 7
  pnpm --filter @vol-arb/api btc5m:research status --days 7 [--with-ga] [--seed 42]
  pnpm --filter @vol-arb/api btc5m:research readiness --days 7 [--with-ga] [--seed 42] [--save-report] [--report-file .local/reports/readiness.json]
  pnpm --filter @vol-arb/api btc5m:research paper-signal --persist
  pnpm --filter @vol-arb/api btc5m:research evaluate-paper-signals --limit 200 [--recheck-settled]
  pnpm --filter @vol-arb/api btc5m:research paper-summary
  pnpm --filter @vol-arb/api btc5m:research backtest --days 7 --limit-markets 2016 --persist [--save-report] [--report-file .local/reports/backtest.json]
  pnpm --filter @vol-arb/api btc5m:research genetic --days 7 --generations 6 --population 12 --validation-fraction 0.2857 [--seed 42] [--persist-best] [--save-report] [--report-file .local/reports/genetic.json]
  pnpm --filter @vol-arb/api btc5m:research genetic-sweep --days 7 --seeds 5 --seed-start 1 --generations 6 --population 12 [--save-report] [--report-file .local/reports/sweep.json]

All simulated orders are limit orders. The default initial capital is 100 USDC and max risk per trade is 10% of current equity.`;
}

function stringArg(args: Args, key: string, fallback = "") {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function beijingSegment(timestamp: number) {
  const date = new Date(timestamp + 8 * 60 * 60 * 1000);
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  const dayType = day === 0 || day === 6 ? "weekend" : "weekday";
  const session = hour >= 8 && hour < 18 ? "beijing_day" : "beijing_night";
  return `${dayType}_${session}`;
}

function parseTargetSegments(args: Args) {
  return stringArg(args, "target-segments")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function defaultSweepReportFile() {
  return resolve(workspaceRoot, ".local/reports", `btc5m-genetic-sweep-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function defaultGeneticReportFile() {
  return resolve(workspaceRoot, ".local/reports", `btc5m-genetic-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function defaultBacktestReportFile() {
  return resolve(workspaceRoot, ".local/reports", `btc5m-backtest-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function defaultReadinessReportFile() {
  return resolve(workspaceRoot, ".local/reports", `btc5m-readiness-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
}

function resolveWorkspacePath(path: string) {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

function saveJsonReport(filePath: string, payload: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function passFail(condition: boolean) {
  return condition ? "pass" : "fail";
}

function unknownUnless(condition: boolean | null) {
  if (condition === null) return "not_evaluated";
  return passFail(condition);
}

async function waitForTargetSegment(input: { targetSegments: string[]; checkSeconds: number; shouldStop: () => boolean }) {
  if (input.targetSegments.length === 0) return beijingSegment(Date.now());
  while (!input.shouldStop()) {
    const current = beijingSegment(Date.now());
    if (input.targetSegments.includes(current)) return current;
    console.error(`collect-orderbook-sessions waiting: currentSegment=${current} targetSegments=${input.targetSegments.join(",")}`);
    await sleep(Math.max(1, input.checkSeconds) * 1000);
  }
  return null;
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command === "probe") {
    console.log(JSON.stringify(await discoverBtc5mDataSources(), null, 2));
    return;
  }
  if (command === "collect-markets") {
    console.log(
      JSON.stringify(
        await collectRecentBtc5mMarkets({
          days: numberArg(args, "days", 7),
          limit: numberArg(args, "limit", 2016),
          throttleMs: numberArg(args, "throttle-ms", 100),
          timeoutMs: numberArg(args, "timeout-ms", 2500),
          onProgress: (progress) => {
            if (progress.processed === progress.total || progress.processed % numberArg(args, "progress-every", 100) === 0) {
              console.error(`collect-markets ${progress.processed}/${progress.total} stored=${progress.stored} missing=${progress.missing} errors=${progress.errors}`);
            }
          },
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "refresh-results") {
    console.log(
      JSON.stringify(
        await collectRecentBtc5mMarkets({
          days: numberArg(args, "days", 7),
          limit: numberArg(args, "limit", 2016),
          throttleMs: numberArg(args, "throttle-ms", 50),
          timeoutMs: numberArg(args, "timeout-ms", 2500),
          onProgress: (progress) => {
            if (progress.processed === progress.total || progress.processed % numberArg(args, "progress-every", 100) === 0) {
              console.error(`refresh-results ${progress.processed}/${progress.total} stored=${progress.stored} missing=${progress.missing} errors=${progress.errors}`);
            }
          },
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "collect-price-history") {
    console.log(
      JSON.stringify(
        await collectBtc5mPriceHistory({
          days: numberArg(args, "days", 7),
          limitMarkets: numberArg(args, "limit-markets", 2016),
          throttleMs: numberArg(args, "throttle-ms", 100),
          fidelitySeconds: numberArg(args, "fidelity-seconds", 60),
          timeoutMs: numberArg(args, "timeout-ms", 3000),
          onProgress: (progress) => {
            if (progress.processed === progress.total || progress.processed % numberArg(args, "progress-every", 50) === 0) {
              console.error(`collect-price-history ${progress.processed}/${progress.total} points=${progress.points} errors=${progress.errors}`);
            }
          },
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "collect-trades") {
    console.log(
      JSON.stringify(
        await collectBtc5mTrades({
          days: numberArg(args, "days", 7),
          limitMarkets: numberArg(args, "limit-markets", 2016),
          stride: numberArg(args, "stride", 1),
          missingOnly: boolArg(args, "missing-only"),
          throttleMs: numberArg(args, "throttle-ms", 100),
          pagesPerMarket: numberArg(args, "pages-per-market", numberArg(args, "pages-per-token", 2)),
          onProgress: (progress) => {
            if (progress.processed === progress.total || progress.processed % numberArg(args, "progress-every", 25) === 0) {
              console.error(`collect-trades ${progress.processed}/${progress.total} trades=${progress.trades} errors=${progress.errors}`);
            }
          },
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "collect-btc-price") {
    console.log(JSON.stringify(await collectAuxiliaryBtcOneMinute({ days: numberArg(args, "days", 7), throttleMs: numberArg(args, "throttle-ms", 200) }), null, 2));
    return;
  }
  if (command === "snapshot-orderbook") {
    console.log(JSON.stringify(await collectCurrentOrderbookSnapshots(), null, 2));
    return;
  }
  if (command === "collect-orderbook-live") {
    let stop = false;
    process.once("SIGINT", () => {
      stop = true;
      console.error("Stopping live orderbook collector after current iteration...");
    });
    process.once("SIGTERM", () => {
      stop = true;
      console.error("Stopping live orderbook collector after current iteration...");
    });
    console.log(
      JSON.stringify(
        await collectLiveOrderbookSnapshots({
          durationSeconds: numberArg(args, "duration-seconds", 300),
          intervalMs: numberArg(args, "interval-ms", 1000),
          maxSnapshots: numberArg(args, "max-snapshots", Number.MAX_SAFE_INTEGER),
          shouldStop: () => stop,
          onProgress: (progress) => {
            if (progress.iterations === 1 || progress.iterations % numberArg(args, "progress-every", 30) === 0) {
              console.error(
                `collect-orderbook-live iterations=${progress.iterations} snapshots=${progress.snapshots} errors=${progress.errors} elapsed=${progress.elapsedSeconds.toFixed(1)}s`,
              );
            }
          },
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "collect-orderbook-sessions") {
    let stop = false;
    process.once("SIGINT", () => {
      stop = true;
      console.error("Stopping session collector after current iteration...");
    });
    process.once("SIGTERM", () => {
      stop = true;
      console.error("Stopping session collector after current iteration...");
    });
    const sessions = Math.max(1, Math.trunc(numberArg(args, "sessions", 12)));
    const pauseSeconds = Math.max(0, numberArg(args, "pause-seconds", 5));
    const targetSegments = parseTargetSegments(args);
    const waitForTarget = boolArg(args, "wait-for-target-segment");
    const segmentCheckSeconds = Math.max(1, numberArg(args, "target-segment-check-seconds", 60));
    const runs = [];
    for (let session = 1; session <= sessions && !stop; session += 1) {
      const currentSegment = targetSegments.length
        ? waitForTarget
          ? await waitForTargetSegment({ targetSegments, checkSeconds: segmentCheckSeconds, shouldStop: () => stop })
          : beijingSegment(Date.now())
        : beijingSegment(Date.now());
      if (stop || !currentSegment) break;
      if (targetSegments.length > 0 && !targetSegments.includes(currentSegment)) {
        console.error(`collect-orderbook-sessions stopped: currentSegment=${currentSegment} targetSegments=${targetSegments.join(",")}`);
        break;
      }
      console.error(`collect-orderbook-sessions session=${session}/${sessions} starting segment=${currentSegment}`);
      const result = await collectLiveOrderbookSnapshots({
        durationSeconds: numberArg(args, "duration-seconds", 300),
        intervalMs: numberArg(args, "interval-ms", 1000),
        maxSnapshots: numberArg(args, "max-snapshots", Number.MAX_SAFE_INTEGER),
        shouldStop: () => stop,
        onProgress: (progress) => {
          if (progress.iterations === 1 || progress.iterations % numberArg(args, "progress-every", 60) === 0) {
            console.error(
              `collect-orderbook-sessions session=${session}/${sessions} segment=${currentSegment} iterations=${progress.iterations} snapshots=${progress.snapshots} errors=${progress.errors} elapsed=${progress.elapsedSeconds.toFixed(1)}s`,
            );
          }
        },
      });
      runs.push(result);
      if (pauseSeconds > 0 && session < sessions && !stop) await new Promise((resolve) => setTimeout(resolve, pauseSeconds * 1000));
    }
    const coverage = await getBtc5mResearchCoverage({ days: numberArg(args, "days", 7) });
    console.log(
      JSON.stringify(
        {
          sessionsRequested: sessions,
          sessionsCompleted: runs.length,
          targetSegments,
          waitForTargetSegment: waitForTarget,
          snapshots: runs.reduce((sum, run) => sum + run.snapshots, 0),
          errors: runs.flatMap((run) => run.errors),
          runs,
          coverage,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "observe-live") {
    let stop = false;
    process.once("SIGINT", () => {
      stop = true;
      console.error("Stopping live observer after current iteration...");
    });
    process.once("SIGTERM", () => {
      stop = true;
      console.error("Stopping live observer after current iteration...");
    });
    console.log(
      JSON.stringify(
        await observeLiveBtc5m({
          durationSeconds: numberArg(args, "duration-seconds", 300),
          intervalMs: numberArg(args, "interval-ms", 1000),
          maxIterations: numberArg(args, "max-iterations", Number.MAX_SAFE_INTEGER),
          persistSignals: !boolArg(args, "no-persist-signals"),
          shouldStop: () => stop,
          onProgress: (progress) => {
            if (progress.iterations === 1 || progress.iterations % numberArg(args, "progress-every", 30) === 0) {
              console.error(
                `observe-live iterations=${progress.iterations} snapshots=${progress.snapshots} signals=${progress.signals} wouldEnter=${progress.wouldEnter} errors=${progress.errors} elapsed=${progress.elapsedSeconds.toFixed(1)}s`,
              );
            }
          },
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "backtest") {
    const result = await runBtc5mBacktest({
      days: numberArg(args, "days", 7),
      limitMarkets: numberArg(args, "limit-markets", 2016),
      persist: boolArg(args, "persist"),
    });
    const reportFile = boolArg(args, "save-report") || args["report-file"] ? resolveWorkspacePath(stringArg(args, "report-file", defaultBacktestReportFile())) : null;
    const output = reportFile ? { ...result, reportFile } : result;
    if (reportFile) saveJsonReport(reportFile, output);
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (command === "coverage") {
    console.log(JSON.stringify(await getBtc5mResearchCoverage({ days: numberArg(args, "days", 7) }), null, 2));
    return;
  }
  if (command === "status") {
    const days = numberArg(args, "days", 7);
    const coverage = await getBtc5mResearchCoverage({ days });
    const paperSummary = await summarizePaperSignals();
    const withGa = boolArg(args, "with-ga");
    const genetic = withGa
      ? await runBtc5mGeneticSearch({
          days,
          limitMarkets: numberArg(args, "limit-markets", 2016),
          generations: numberArg(args, "generations", 1),
          population: numberArg(args, "population", 4),
          validationFraction: numberArg(args, "validation-fraction", 2 / 7),
          seed: args.seed === undefined ? 42 : numberArg(args, "seed", 42),
        })
      : null;
    console.log(
      JSON.stringify(
        {
          days,
          coverage,
          paperSummary,
          genetic,
          nextAction:
            coverage.executionQuality === "partial_orderbook" || coverage.executionQuality === "orderbook_backtest_ready"
              ? "Run a larger seeded GA and inspect validation plus stress validation."
              : "Continue forward orderbook collection before treating GA output as robust.",
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "readiness") {
    const days = numberArg(args, "days", 7);
    const coverage = await getBtc5mResearchCoverage({ days });
    const paperSummary = await summarizePaperSignals();
    const withGa = boolArg(args, "with-ga");
    const genetic = withGa
      ? await runBtc5mGeneticSearch({
          days,
          limitMarkets: numberArg(args, "limit-markets", 2016),
          generations: numberArg(args, "generations", 1),
          population: numberArg(args, "population", 4),
          validationFraction: numberArg(args, "validation-fraction", 2 / 7),
          seed: args.seed === undefined ? 42 : numberArg(args, "seed", 42),
        })
      : null;
    const executionQualityAccepted = coverage.executionQuality === "partial_orderbook" || coverage.executionQuality === "orderbook_backtest_ready";
    const segmentRows = Object.values(coverage.segmentMarketCoverage);
    const partialOrderbookSegments = segmentRows.filter((segment) => segment.orderbookMarketCoverage >= 0.1).length;
    const blockedStrategies = Array.isArray(paperSummary.blockedStrategies) ? paperSummary.blockedStrategies : [];
    const defaultRiskControlsPass =
      DEFAULT_BACKTEST_PARAMS.initialCapital === 100 &&
      DEFAULT_BACKTEST_PARAMS.maxRiskFraction <= 0.1 &&
      DEFAULT_BACKTEST_PARAMS.maxDailyLossFraction <= 0.2 &&
      DEFAULT_BACKTEST_PARAMS.maxDrawdownFraction <= 0.25 &&
      DEFAULT_BACKTEST_PARAMS.maxConsecutiveLosses <= 6 &&
      DEFAULT_BACKTEST_PARAMS.maxOpenMarkets <= 1 &&
      DEFAULT_BACKTEST_PARAMS.maxDailyTrades > 0 &&
      DEFAULT_BACKTEST_PARAMS.maxLiquidityParticipation <= 0.25;
    const checks = [
      {
        id: "market_sample",
        status: passFail(coverage.markets >= 500 && coverage.resolvedMarkets >= 500),
        observed: { markets: coverage.markets, resolvedMarkets: coverage.resolvedMarkets },
        required: ">= 500 markets and resolvedMarkets",
      },
      {
        id: "trade_market_coverage",
        status: passFail(coverage.tradeMarketCoverage >= 0.5),
        observed: coverage.tradeMarketCoverage,
        required: ">= 0.5",
      },
      {
        id: "orderbook_market_coverage",
        status: passFail(coverage.orderbookMarketCoverage >= 0.1),
        observed: coverage.orderbookMarketCoverage,
        required: ">= 0.1 partial_orderbook",
      },
      {
        id: "balanced_beijing_orderbook_segments",
        status: passFail(partialOrderbookSegments >= 3),
        observed: partialOrderbookSegments,
        required: ">= 3 Beijing regimes with >= 10% orderbook coverage",
      },
      {
        id: "execution_quality",
        status: passFail(executionQualityAccepted),
        observed: coverage.executionQuality,
        required: "partial_orderbook or orderbook_backtest_ready",
      },
      {
        id: "paper_signal_evidence",
        status: passFail(blockedStrategies.length === 0),
        observed: blockedStrategies,
        required: "no strategy blocked by settled negative paper evidence",
      },
      {
        id: "genetic_acceptance",
        status: unknownUnless(genetic ? genetic.accepted : null),
        observed: genetic
          ? {
              accepted: genetic.accepted,
              strategy: genetic.bestTrain.strategy,
              targetSegment: genetic.bestTrain.parameters.targetSegment,
              blockers: genetic.acceptanceBlockers.map((blocker) => blocker.code),
            }
          : "run with --with-ga to evaluate",
        required: "accepted=true with no acceptanceBlockers",
      },
      {
        id: "risk_controls",
        status: passFail(defaultRiskControlsPass),
        observed: {
          initialCapital: DEFAULT_BACKTEST_PARAMS.initialCapital,
          maxRiskFraction: DEFAULT_BACKTEST_PARAMS.maxRiskFraction,
          maxDailyLossFraction: DEFAULT_BACKTEST_PARAMS.maxDailyLossFraction,
          maxDrawdownFraction: DEFAULT_BACKTEST_PARAMS.maxDrawdownFraction,
          maxConsecutiveLosses: DEFAULT_BACKTEST_PARAMS.maxConsecutiveLosses,
          maxOpenMarkets: DEFAULT_BACKTEST_PARAMS.maxOpenMarkets,
          maxDailyTrades: DEFAULT_BACKTEST_PARAMS.maxDailyTrades,
          maxLiquidityParticipation: DEFAULT_BACKTEST_PARAMS.maxLiquidityParticipation,
          limitOrdersOnly: true,
        },
        required: "100 USDC default capital, <=10% per-trade risk, <=20% daily loss, <=25% drawdown, <=6 consecutive losses, <=1 open market, max daily trades set, <=25% visible liquidity participation",
      },
    ];
    const failedChecks = checks.filter((check) => check.status === "fail").map((check) => check.id);
    const notEvaluatedChecks = checks.filter((check) => check.status === "not_evaluated").map((check) => check.id);
    const liveReady = failedChecks.length === 0 && notEvaluatedChecks.length === 0;
    const reportFile = boolArg(args, "save-report") || args["report-file"] ? resolveWorkspacePath(stringArg(args, "report-file", defaultReadinessReportFile())) : null;
    const output = {
      days,
      liveReady,
      failedChecks,
      notEvaluatedChecks,
      checks,
      nextAction: liveReady
        ? "Review saved GA/backtest reports manually before enabling any live order path."
        : executionQualityAccepted
          ? "Run readiness with --with-ga and inspect failed validation, stress, or paper-signal gates."
          : "Continue forward orderbook collection until partial_orderbook coverage is reached across Beijing regimes.",
      coverageSummary: {
        executionQuality: coverage.executionQuality,
        markets: coverage.markets,
        marketsWithTrades: coverage.marketsWithTrades,
        marketsWithOrderbook: coverage.marketsWithOrderbook,
        orderbookTargets: coverage.orderbookTargets,
        weakestOrderbookSegments: coverage.weakestOrderbookSegments,
      },
      reportFile,
    };
    if (reportFile) saveJsonReport(reportFile, output);
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (command === "paper-signal") {
    console.log(JSON.stringify(await evaluateLatestBtc5mPaperSignal({ persist: boolArg(args, "persist") }), null, 2));
    return;
  }
  if (command === "evaluate-paper-signals") {
    console.log(JSON.stringify(await evaluateResolvedPaperSignals({ limit: numberArg(args, "limit", 200), recheckSettled: boolArg(args, "recheck-settled") }), null, 2));
    return;
  }
  if (command === "paper-summary") {
    console.log(JSON.stringify(await summarizePaperSignals(), null, 2));
    return;
  }
  if (command === "genetic") {
    const result = await runBtc5mGeneticSearch({
      days: numberArg(args, "days", 7),
      limitMarkets: numberArg(args, "limit-markets", 2016),
      generations: numberArg(args, "generations", 6),
      population: numberArg(args, "population", 12),
      validationFraction: numberArg(args, "validation-fraction", 2 / 7),
      seed: args.seed === undefined ? undefined : numberArg(args, "seed", 0),
      persistBest: boolArg(args, "persist-best"),
    });
    const reportFile = boolArg(args, "save-report") || args["report-file"] ? resolveWorkspacePath(stringArg(args, "report-file", defaultGeneticReportFile())) : null;
    const output = reportFile ? { ...result, reportFile } : result;
    if (reportFile) saveJsonReport(reportFile, output);
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  if (command === "genetic-sweep") {
    const days = numberArg(args, "days", 7);
    const seedStart = Math.trunc(numberArg(args, "seed-start", 1));
    const seedCount = Math.max(1, Math.trunc(numberArg(args, "seeds", 5)));
    const runs = [];
    for (let index = 0; index < seedCount; index += 1) {
      const seed = seedStart + index;
      const result = await runBtc5mGeneticSearch({
        days,
        limitMarkets: numberArg(args, "limit-markets", 2016),
        generations: numberArg(args, "generations", 6),
        population: numberArg(args, "population", 12),
        validationFraction: numberArg(args, "validation-fraction", 2 / 7),
        seed,
      });
      runs.push({
        seed,
        accepted: result.accepted,
        executionQuality: result.dataset.executionQuality,
        partialOrderbookSegments: result.dataset.partialOrderbookSegments,
        acceptanceGates: result.acceptanceGates,
        acceptanceBlockers: result.acceptanceBlockers,
        bestTrain: {
          strategy: result.bestTrain.strategy,
          totalPnl: result.bestTrain.totalPnl,
          returnOnCapital: result.bestTrain.returnOnCapital,
          profitFactor: result.bestTrain.profitFactor,
          averageTradePnl: result.bestTrain.averageTradePnl,
          tradeCount: result.bestTrain.tradeCount,
          maxDrawdown: result.bestTrain.maxDrawdown,
          maxDrawdownFraction: result.bestTrain.maxDrawdownFraction,
          parameters: result.bestTrain.parameters,
        },
        validation: {
          totalPnl: result.validation.totalPnl,
          returnOnCapital: result.validation.returnOnCapital,
          profitFactor: result.validation.profitFactor,
          averageTradePnl: result.validation.averageTradePnl,
          tradeCount: result.validation.tradeCount,
          maxDrawdown: result.validation.maxDrawdown,
          maxDrawdownFraction: result.validation.maxDrawdownFraction,
          winRate: result.validation.winRate,
          segmentBreakdown: result.validation.segmentBreakdown,
        },
        stressValidation: {
          totalPnl: result.stressValidation.totalPnl,
          returnOnCapital: result.stressValidation.returnOnCapital,
          profitFactor: result.stressValidation.profitFactor,
          averageTradePnl: result.stressValidation.averageTradePnl,
          tradeCount: result.stressValidation.tradeCount,
          maxDrawdown: result.stressValidation.maxDrawdown,
          maxDrawdownFraction: result.stressValidation.maxDrawdownFraction,
          winRate: result.stressValidation.winRate,
        },
        walkForwardValidation: {
          accepted: result.walkForwardValidation.accepted,
          windowCount: result.walkForwardValidation.windowCount,
          totalPnl: result.walkForwardValidation.totalPnl,
          totalTrades: result.walkForwardValidation.totalTrades,
          profitableWindows: result.walkForwardValidation.profitableWindows,
          losingWindows: result.walkForwardValidation.losingWindows,
        },
      });
    }
    const blockerCounts: Record<string, number> = {};
    const strategyCounts: Record<string, number> = {};
    const targetSegmentCounts: Record<string, number> = {};
    for (const run of runs) {
      strategyCounts[run.bestTrain.strategy] = (strategyCounts[run.bestTrain.strategy] ?? 0) + 1;
      const targetSegment = String(run.bestTrain.parameters.targetSegment);
      targetSegmentCounts[targetSegment] = (targetSegmentCounts[targetSegment] ?? 0) + 1;
      for (const blocker of run.acceptanceBlockers) {
        blockerCounts[blocker.code] = (blockerCounts[blocker.code] ?? 0) + 1;
      }
    }
    const bestValidationRun = runs
      .map((run) => ({ seed: run.seed, totalPnl: run.validation.totalPnl, tradeCount: run.validation.tradeCount, winRate: run.validation.winRate, strategy: run.bestTrain.strategy, targetSegment: run.bestTrain.parameters.targetSegment }))
      .sort((a, b) => b.totalPnl - a.totalPnl || b.tradeCount - a.tradeCount)[0];
    const bestWalkForwardRun = runs
      .map((run) => ({
        seed: run.seed,
        totalPnl: run.walkForwardValidation.totalPnl,
        totalTrades: run.walkForwardValidation.totalTrades,
        profitableWindows: run.walkForwardValidation.profitableWindows,
        losingWindows: run.walkForwardValidation.losingWindows,
        strategy: run.bestTrain.strategy,
        targetSegment: run.bestTrain.parameters.targetSegment,
      }))
      .sort((a, b) => b.totalPnl - a.totalPnl || b.profitableWindows - a.profitableWindows)[0];
    const reportFile = boolArg(args, "save-report") || args["report-file"] ? resolveWorkspacePath(stringArg(args, "report-file", defaultSweepReportFile())) : null;
    const output = {
      days,
      seedStart,
      seeds: seedCount,
      acceptedCount: runs.filter((run) => run.accepted).length,
      executionQualities: [...new Set(runs.map((run) => run.executionQuality))],
      blockerCounts,
      strategyCounts,
      targetSegmentCounts,
      bestValidationRun,
      bestWalkForwardRun,
      reportFile,
      runs,
    };
    if (reportFile) saveJsonReport(reportFile, output);
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
