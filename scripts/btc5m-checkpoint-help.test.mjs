import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["scripts/btc5m-checkpoint.mjs", "--help"], {
  encoding: "utf8",
});

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /pnpm btc5m:checkpoint \[--no-ga\] \[--summary-only\] \[--require-live-ready\]/);
assert.match(result.stdout, /pnpm btc5m:checkpoint:status/);
assert.match(result.stdout, /pnpm btc5m:checkpoint:gate/);
assert.match(result.stdout, /BTC5M_CHECKPOINT_REPORT_FILE/);

console.log("btc5m-checkpoint-help tests passed");
