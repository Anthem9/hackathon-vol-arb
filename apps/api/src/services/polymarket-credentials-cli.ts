import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Chain, ClobClient, SignatureTypeV2, type ApiKeyCreds } from "@polymarket/clob-client-v2";
import { createWalletClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

function findUp(file: string) {
  let current = process.cwd();
  while (true) {
    const candidate = join(current, file);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return "";
    current = parent;
  }
}

function loadEnvFile(file = ".env") {
  const envFile = findUp(file);
  if (!envFile) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function envValue(name: string) {
  return process.env[name]?.trim() ?? "";
}

function isPrivateKey(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function clobUrl() {
  return envValue("POLYMARKET_API_BASE") || "https://clob.polymarket.com";
}

function chainId() {
  const value = Number(envValue("POLYMARKET_CHAIN_ID") || "137");
  if (value === Chain.AMOY) return Chain.AMOY;
  return Chain.POLYGON;
}

function signatureType() {
  const value = Number(envValue("POLYMARKET_SIGNATURE_TYPE") || "0");
  if (value === SignatureTypeV2.POLY_PROXY) return SignatureTypeV2.POLY_PROXY;
  if (value === SignatureTypeV2.POLY_GNOSIS_SAFE) return SignatureTypeV2.POLY_GNOSIS_SAFE;
  if (value === SignatureTypeV2.POLY_1271) return SignatureTypeV2.POLY_1271;
  return SignatureTypeV2.EOA;
}

function parseArgs(argv: string[]) {
  const args = {
    createOrDerive: false,
    writeEnv: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--create-or-derive") args.createOrDerive = true;
    else if (arg === "--write-env") args.writeEnv = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return `Usage:
  pnpm --filter @vol-arb/api polymarket:credentials
  pnpm --filter @vol-arb/api polymarket:credentials --create-or-derive --write-env .env

Default mode is read-only and only reports whether wallet signing material and L2 credentials are configured.
--create-or-derive calls Polymarket CLOB L1 auth to create or derive L2 API credentials.
--write-env writes credentials to a local ignored env file and never prints the secret or passphrase.`;
}

function assertSafeEnvOutput(file: string) {
  const normalized = file.trim();
  if (!normalized) throw new Error("--write-env is required when --create-or-derive is used.");
  if (!/^\.env($|\.local$|\..*\.local$)/.test(normalized)) {
    throw new Error("--write-env must be .env, .env.local, or .env.*.local so repository ignore rules protect it.");
  }
  return resolve(normalized);
}

function updateEnvText(existing: string, values: Record<string, string>) {
  const lines = existing ? existing.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const updated = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in values)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`);
  }
  return `${updated.filter((line, index) => line !== "" || index < updated.length - 1).join("\n")}\n`;
}

function redact(value: string) {
  if (!value) return "missing";
  if (value.length <= 8) return "configured";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function createOrDerive(outputFile: string) {
  const privateKey = envValue("POLYMARKET_PRIVATE_KEY") || envValue("POLYGON_TEST_PRIVATE_KEY");
  if (!isPrivateKey(privateKey)) throw new Error("POLYMARKET_PRIVATE_KEY or POLYGON_TEST_PRIVATE_KEY must be a 0x-prefixed private key.");

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const configuredWallet = envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  if (configuredWallet && account.address.toLowerCase() !== configuredWallet.toLowerCase()) {
    throw new Error(`Configured Polymarket wallet ${configuredWallet} does not match private key address ${account.address}.`);
  }

  const walletClient = createWalletClient({ account, transport: http(envValue("POLYGON_RPC_HTTP") || undefined) });
  const client = new ClobClient({
    host: clobUrl(),
    chain: chainId(),
    signer: walletClient,
    signatureType: signatureType(),
    funderAddress: envValue("POLYMARKET_FUNDER_ADDRESS") || undefined,
    throwOnError: true,
  });
  const creds = (await client.createOrDeriveApiKey()) as ApiKeyCreds;
  if (!creds.key || !creds.secret || !creds.passphrase) throw new Error("Polymarket returned incomplete L2 credentials.");

  const envPath = assertSafeEnvOutput(outputFile);
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  writeFileSync(
    envPath,
    updateEnvText(existing, {
      POLYMARKET_WALLET_ADDRESS: account.address,
      POLYMARKET_API_KEY: creds.key,
      POLYMARKET_API_SECRET: creds.secret,
      POLYMARKET_API_PASSPHRASE: creds.passphrase,
    }),
    { mode: 0o600 },
  );

  return {
    walletAddress: account.address,
    envFile: envPath,
    apiKey: redact(creds.key),
  };
}

async function main() {
  loadEnvFile();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const privateKey = envValue("POLYMARKET_PRIVATE_KEY") || envValue("POLYGON_TEST_PRIVATE_KEY");
  const configuredWallet = envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  const privateKeyAddress = isPrivateKey(privateKey) ? privateKeyToAccount(privateKey as `0x${string}`).address : "";
  const walletMatches = configuredWallet && privateKeyAddress ? configuredWallet.toLowerCase() === privateKeyAddress.toLowerCase() : false;

  const report = {
    clobUrl: clobUrl(),
    chainId: chainId(),
    signatureType: signatureType(),
    configuredWallet: configuredWallet || null,
    configuredWalletValid: configuredWallet ? isAddress(configuredWallet) : false,
    privateKeyConfigured: isPrivateKey(privateKey),
    privateKeyAddress: privateKeyAddress || null,
    walletMatchesPrivateKey: walletMatches,
    l2CredentialsConfigured: Boolean(envValue("POLYMARKET_API_KEY") && envValue("POLYMARKET_API_SECRET") && envValue("POLYMARKET_API_PASSPHRASE")),
    liveTradingEnabled: envValue("POLYMARKET_ENABLE_LIVE_TRADING") === "true",
  };

  if (!args.createOrDerive) {
    console.log(JSON.stringify({ mode: "check", report, nextAction: "Use --create-or-derive --write-env .env to create or derive L2 credentials." }, null, 2));
    return;
  }

  const result = await createOrDerive(args.writeEnv);
  console.log(JSON.stringify({ mode: "create-or-derive", report: { ...report, l2CredentialsConfigured: true }, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
