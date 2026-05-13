import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

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
assert.match(lastResult.stdout, /pnpm btc5m:checkpoint:last \[--full\]/);
assert.match(lastResult.stdout, /without\s+running coverage, readiness, GA, network calls, or orderbook collection/);

console.log("btc5m-checkpoint-help tests passed");
