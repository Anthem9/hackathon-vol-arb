import { existsSync, readFileSync } from "node:fs";

const profile = process.argv[2] ?? process.env.VOLARB_ENV_PROFILE ?? "local";
const allowedProfiles = new Set(["local", "staging", "production-like"]);

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function hasValue(key) {
  return typeof process.env[key] === "string" && process.env[key].trim() !== "";
}

function requireKeys(keys, findings) {
  for (const key of keys) {
    if (!hasValue(key)) findings.errors.push(`${key} is required.`);
  }
}

function warnMissing(keys, findings) {
  for (const key of keys) {
    if (!hasValue(key)) findings.warnings.push(`${key} is not set.`);
  }
}

function checkUrl(key, findings) {
  if (!hasValue(key)) return;
  try {
    const parsed = new URL(process.env[key]);
    if (!["http:", "https:", "postgres:"].includes(parsed.protocol)) {
      findings.errors.push(`${key} uses unsupported protocol ${parsed.protocol}.`);
    }
  } catch {
    findings.errors.push(`${key} must be a valid URL.`);
  }
}

function checkSuiTestnetBoundary(findings) {
  if (process.env.SUI_NETWORK !== "testnet") {
    findings.errors.push("SUI_NETWORK must remain testnet while DeepBook Predict has no supported mainnet execution path.");
  }
  if (hasValue("DEEPBOOK_PREDICT_MANAGER_ID") && !/^0x[0-9a-fA-F]{64}$/.test(process.env.DEEPBOOK_PREDICT_MANAGER_ID)) {
    findings.errors.push("DEEPBOOK_PREDICT_MANAGER_ID must be a 32-byte Sui object ID when set.");
  }
  if (hasValue("DEEPBOOK_PREDICT_PACKAGE_ID") && !/^0x[0-9a-fA-F]{64}$/.test(process.env.DEEPBOOK_PREDICT_PACKAGE_ID)) {
    findings.errors.push("DEEPBOOK_PREDICT_PACKAGE_ID must be a 32-byte Sui object ID.");
  }
}

function checkTradingBoundary(findings) {
  if (process.env.POLYMARKET_ENABLE_LIVE_TRADING === "true" && process.env.POLYMARKET_LIVE_TRADING_APPROVED !== "true") {
    findings.errors.push("POLYMARKET_ENABLE_LIVE_TRADING requires POLYMARKET_LIVE_TRADING_APPROVED=true after operator risk approval.");
  }
  if (hasValue("POLYMARKET_CHAIN_ID") && !["137", "80002"].includes(process.env.POLYMARKET_CHAIN_ID.trim())) {
    findings.errors.push("POLYMARKET_CHAIN_ID must be 137 for Polygon or 80002 for Polygon Amoy.");
  }
}

if (!allowedProfiles.has(profile)) {
  console.error(`Unknown env profile: ${profile}. Use local, staging, or production-like.`);
  process.exit(1);
}

loadEnvFile(".env");

const findings = { errors: [], warnings: [] };

requireKeys(["NEXT_PUBLIC_API_BASE_URL", "API_PORT", "DATA_MODE", "DATABASE_URL", "SUI_NETWORK"], findings);
requireKeys(
  [
    "DEEPBOOK_PREDICT_SERVER_URL",
    "DEEPBOOK_PREDICT_PACKAGE_ID",
    "DEEPBOOK_PREDICT_REGISTRY_ID",
    "DEEPBOOK_PREDICT_OBJECT_ID",
    "DEEPBOOK_QUOTE_ASSET_TYPE",
    "DEEPBOOK_QUOTE_ASSET_CURRENCY_ID",
    "POLYMARKET_API_BASE",
    "POLYMARKET_GAMMA_API_BASE",
  ],
  findings,
);

checkUrl("NEXT_PUBLIC_API_BASE_URL", findings);
checkUrl("DATABASE_URL", findings);
checkUrl("DEEPBOOK_PREDICT_SERVER_URL", findings);
checkUrl("POLYMARKET_API_BASE", findings);
checkUrl("POLYMARKET_GAMMA_API_BASE", findings);
checkUrl("POLYMARKET_DATA_API_BASE", findings);
checkSuiTestnetBoundary(findings);
checkTradingBoundary(findings);

if (profile === "local") {
  warnMissing(["SUI_TESTNET_ADDRESS", "SUI_TESTNET_PRIVATE_KEY"], findings);
}

if (profile === "staging" || profile === "production-like") {
  requireKeys(["SUI_TESTNET_RPC_HTTPS", "SUI_TESTNET_ADDRESS"], findings);
  warnMissing(["SUI_TESTNET_GRPC_ENDPOINT", "SUI_TESTNET_GRPC_X_TOKEN"], findings);
}

if (profile === "production-like") {
  if (process.env.DATA_MODE !== "hybrid" && process.env.DATA_MODE !== "real") {
    findings.errors.push("production-like DATA_MODE must be hybrid or real.");
  }
  requireKeys(["POLYMARKET_WALLET_ADDRESS"], findings);
  warnMissing(["POLYMARKET_API_KEY", "POLYMARKET_API_SECRET", "POLYMARKET_API_PASSPHRASE"], findings);
  if (process.env.ENABLE_MAINTENANCE_SCHEDULER !== "true") {
    findings.warnings.push("ENABLE_MAINTENANCE_SCHEDULER is not true.");
  }
}

for (const warning of findings.warnings) console.warn(`warning: ${warning}`);

if (findings.errors.length > 0) {
  console.error(`env check failed for ${profile}:`);
  for (const error of findings.errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`env check passed for ${profile}`);
