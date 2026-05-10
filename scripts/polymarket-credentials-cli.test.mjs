import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliArgs = ["--filter", "@vol-arb/api", "exec", "tsx", "src/services/polymarket-credentials-cli.ts"];
const testPrivateKey = `0x${"1".repeat(64)}`;
const testAddress = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";

function runCli(args = [], overrides = {}) {
  return spawnSync("pnpm", [...cliArgs, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      POLYMARKET_API_BASE: "https://clob.polymarket.com",
      POLYMARKET_CHAIN_ID: "137",
      POLYMARKET_WALLET_ADDRESS: testAddress,
      POLYMARKET_PRIVATE_KEY: testPrivateKey,
      POLYMARKET_ENABLE_LIVE_TRADING: "false",
      ...overrides,
    },
    encoding: "utf8",
  });
}

const help = runCli(["--help"]);
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /Usage:/);

const check = runCli();
assert.equal(check.status, 0, check.stderr);
const report = JSON.parse(check.stdout);
assert.equal(report.mode, "check");
assert.equal(report.report.configuredWalletValid, true);
assert.equal(report.report.privateKeyConfigured, true);
assert.equal(report.report.walletMatchesPrivateKey, true);
assert.equal(report.report.l2CredentialsConfigured, false);
assert.equal(report.report.liveTradingEnabled, false);

const missingWriteEnv = runCli(["--create-or-derive"]);
assert.notEqual(missingWriteEnv.status, 0);
assert.match(missingWriteEnv.stderr, /--write-env is required/);

const unsafeWriteEnv = runCli(["--create-or-derive", "--write-env", "polymarket.env"]);
assert.notEqual(unsafeWriteEnv.status, 0);
assert.match(unsafeWriteEnv.stderr, /--write-env must be/);

console.log("polymarket credential cli tests passed");
