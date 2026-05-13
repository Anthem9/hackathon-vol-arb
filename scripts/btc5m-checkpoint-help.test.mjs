import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const result = spawnSync("node", ["scripts/btc5m-checkpoint.mjs", "--help"], {
  encoding: "utf8",
});
const lastResult = spawnSync("node", ["scripts/btc5m-checkpoint-last.mjs", "--help"], {
  encoding: "utf8",
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /pnpm btc5m:checkpoint \[--no-ga\] \[--summary-only\] \[--require-live-ready\]/);
assert.match(result.stdout, /pnpm btc5m:checkpoint:status/);
assert.match(result.stdout, /pnpm btc5m:checkpoint:gate/);
assert.match(result.stdout, /BTC5M_CHECKPOINT_REPORT_FILE/);
assert.equal(lastResult.status, 0, lastResult.stderr || lastResult.stdout);
assert.match(lastResult.stdout, /pnpm btc5m:checkpoint:last \[--full\] \[--require-current\] \[--require-live-ready\]/);
assert.match(lastResult.stdout, /without\s+running coverage, readiness, GA, network calls, or orderbook collection/);
assert.match(lastResult.stdout, /BTC5M_CHECKPOINT_REPORT_DIR/);

const tempReports = mkdtempSync(join(tmpdir(), "btc5m-checkpoint-last-"));
try {
  writeFileSync(
    join(tempReports, "btc5m-checkpoint-older.json"),
    `${JSON.stringify({
      generatedAt: "2026-05-13T01:00:00.000Z",
      summary: { liveReady: false, marketsWithOrderbook: 1 },
      liveReady: false,
    })}\n`,
  );
  writeFileSync(
    join(tempReports, "btc5m-checkpoint-newer.json"),
    `${JSON.stringify({
      generatedAt: "2026-05-13T02:00:00.000Z",
      git: { shortHead: "test" },
      runtime: { node: "test" },
      inputs: { withGa: false },
      summary: { liveReady: true, marketsWithOrderbook: 2 },
      liveReady: true,
      recommendedAction: "review_reports_before_live_operation",
      failedChecks: [],
      notEvaluatedChecks: [],
    })}\n`,
  );

  const lastSummaryResult = spawnSync("node", ["scripts/btc5m-checkpoint-last.mjs"], {
    encoding: "utf8",
    env: { ...process.env, BTC5M_CHECKPOINT_REPORT_DIR: tempReports },
  });
  assert.equal(lastSummaryResult.status, 0, lastSummaryResult.stderr || lastSummaryResult.stdout);
  const lastSummary = JSON.parse(lastSummaryResult.stdout);
  assert.equal(lastSummary.generatedAt, "2026-05-13T02:00:00.000Z");
  assert.equal(lastSummary.summary.marketsWithOrderbook, 2);
  assert.equal(lastSummary.liveReady, true);
  assert.ok(lastSummary.currentGit?.head);
  assert.equal(typeof lastSummary.reportMatchesCurrentHead, "boolean");

  const staleResult = spawnSync("node", ["scripts/btc5m-checkpoint-last.mjs", "--require-current"], {
    encoding: "utf8",
    env: { ...process.env, BTC5M_CHECKPOINT_REPORT_DIR: tempReports },
  });
  assert.equal(staleResult.status, 2, staleResult.stderr || staleResult.stdout);
  const staleSummary = JSON.parse(staleResult.stdout);
  assert.equal(staleSummary.reportMatchesCurrentHead, false);

  const staleLiveResult = spawnSync("node", ["scripts/btc5m-checkpoint-last.mjs", "--require-current", "--require-live-ready"], {
    encoding: "utf8",
    env: { ...process.env, BTC5M_CHECKPOINT_REPORT_DIR: tempReports },
  });
  assert.equal(staleLiveResult.status, 2, staleLiveResult.stderr || staleLiveResult.stdout);

  const notLiveResult = spawnSync("node", ["scripts/btc5m-checkpoint-last.mjs", "--require-live-ready"], {
    encoding: "utf8",
    env: { ...process.env, BTC5M_CHECKPOINT_REPORT_DIR: tempReports },
  });
  assert.equal(notLiveResult.status, 0, notLiveResult.stderr || notLiveResult.stdout);

  writeFileSync(
    join(tempReports, "btc5m-checkpoint-newest-not-live.json"),
    `${JSON.stringify({
      generatedAt: "2026-05-13T03:00:00.000Z",
      summary: { liveReady: false, marketsWithOrderbook: 3 },
      liveReady: false,
    })}\n`,
  );
  const liveGateResult = spawnSync("node", ["scripts/btc5m-checkpoint-last.mjs", "--require-live-ready"], {
    encoding: "utf8",
    env: { ...process.env, BTC5M_CHECKPOINT_REPORT_DIR: tempReports },
  });
  assert.equal(liveGateResult.status, 3, liveGateResult.stderr || liveGateResult.stdout);
} finally {
  rmSync(tempReports, { recursive: true, force: true });
}

console.log("btc5m-checkpoint-help tests passed");
