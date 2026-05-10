import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const envCheck = join(repoRoot, "scripts/env-check.mjs");

const baseEnv = {
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:4000",
  API_PORT: "4000",
  DATA_MODE: "hybrid",
  DATABASE_URL: "postgres://volarb:volarb@localhost:5432/volarb",
  SUI_NETWORK: "testnet",
  DEEPBOOK_PREDICT_SERVER_URL: "https://predict-server.testnet.mystenlabs.com",
  DEEPBOOK_PREDICT_PACKAGE_ID: `0x${"1".repeat(64)}`,
  DEEPBOOK_PREDICT_REGISTRY_ID: `0x${"2".repeat(64)}`,
  DEEPBOOK_PREDICT_OBJECT_ID: `0x${"3".repeat(64)}`,
  DEEPBOOK_QUOTE_ASSET_TYPE: `0x${"4".repeat(64)}::dusdc::DUSDC`,
  DEEPBOOK_QUOTE_ASSET_CURRENCY_ID: `0x${"5".repeat(64)}`,
  POLYMARKET_API_BASE: "https://clob.polymarket.com",
  POLYMARKET_GAMMA_API_BASE: "https://gamma-api.polymarket.com",
  POLYMARKET_DATA_API_BASE: "https://data-api.polymarket.com",
  POLYMARKET_CHAIN_ID: "137",
  POLYMARKET_ENABLE_LIVE_TRADING: "false",
};

function runEnvCheck(overrides = {}, profile = "local") {
  const cwd = mkdtempSync(join(tmpdir(), "volarb-env-check-"));
  return spawnSync(process.execPath, [envCheck, profile], {
    cwd,
    env: {
      PATH: process.env.PATH,
      ...baseEnv,
      ...overrides,
    },
    encoding: "utf8",
  });
}

const testnet = runEnvCheck();
assert.equal(testnet.status, 0, testnet.stderr);
assert.match(testnet.stdout, /env check passed for local/);

const mainnet = runEnvCheck({ SUI_NETWORK: "mainnet" });
assert.notEqual(mainnet.status, 0);
assert.match(mainnet.stderr, /SUI_NETWORK must remain testnet/);

const liveTrading = runEnvCheck({ POLYMARKET_ENABLE_LIVE_TRADING: "true" });
assert.notEqual(liveTrading.status, 0);
assert.match(liveTrading.stderr, /POLYMARKET_ENABLE_LIVE_TRADING must stay false/);

const invalidPolymarketChain = runEnvCheck({ POLYMARKET_CHAIN_ID: "1" });
assert.notEqual(invalidPolymarketChain.status, 0);
assert.match(invalidPolymarketChain.stderr, /POLYMARKET_CHAIN_ID must be 137/);

const productionLikeMock = runEnvCheck(
  {
    DATA_MODE: "mock",
    SUI_TESTNET_RPC_HTTPS: "https://fullnode.testnet.sui.io:443",
    SUI_TESTNET_ADDRESS: `0x${"6".repeat(64)}`,
    POLYMARKET_WALLET_ADDRESS: `0x${"7".repeat(40)}`,
  },
  "production-like",
);
assert.notEqual(productionLikeMock.status, 0);
assert.match(productionLikeMock.stderr, /production-like DATA_MODE must be hybrid or real/);

console.log("env-check boundary tests passed");
