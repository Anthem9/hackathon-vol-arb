import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, basename } from "node:path";

const allowlistedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".toml",
  ".yaml",
  ".yml",
]);

const blockedBasenames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.staging",
  ".env.test",
]);

const assignmentPatterns = [
  {
    name: "private key assignment",
    pattern: /\b(?:PRIVATE_KEY|SUI_PRIVATE_KEY|POLY_PRIVATE_KEY|WALLET_PRIVATE_KEY)\b\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{32,})/i,
  },
  {
    name: "mnemonic assignment",
    pattern: /\b(?:MNEMONIC|SEED_PHRASE|RECOVERY_PHRASE)\b\s*[:=]\s*["']?([a-z]+(?:\s+[a-z]+){11,23})["']?/i,
  },
  {
    name: "API secret assignment",
    pattern: /\b(?:API_SECRET|SECRET_KEY|POLY_SECRET|POLY_PASSPHRASE|AUTH_TOKEN|X_TOKEN)\b\s*[:=]\s*["']?([A-Za-z0-9+/=_-]{20,})/i,
  },
  {
    name: "RPC tokenized URL",
    pattern: /https?:\/\/[^\s"'`]+\/(?:sui|sui_testnet|sui_graphql)[^\s"'`]*\/[A-Za-z0-9_-]{32,}/i,
  },
];

function gitFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--modified", "--others", "--exclude-standard"], {
    encoding: "utf8",
  });
  return Array.from(new Set(output.split("\n").filter(Boolean))).sort();
}

function shouldScan(file) {
  const name = basename(file);
  if (blockedBasenames.has(name) || name.startsWith(".env.")) return false;
  if (file.includes("node_modules/") || file.includes(".next/") || file.includes("dist/") || file.includes("coverage/")) return false;
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  return allowlistedExtensions.has(extname(file)) || name === "Dockerfile";
}

const findings = [];

for (const file of gitFiles().filter(shouldScan)) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const check of assignmentPatterns) {
      if (check.pattern.test(line)) {
        findings.push({ file, line: index + 1, check: check.name });
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.check}`);
  }
  process.exit(1);
}

console.log("secret scan passed");
