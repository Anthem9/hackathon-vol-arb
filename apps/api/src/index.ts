import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_API_PORT, SUPPORTED_WEB_ORIGINS } from "@vol-arb/config";
import { opportunitiesRoute } from "./routes/opportunities";
import { overviewRoute } from "./routes/overview";
import { paperTradesRoute } from "./routes/paper-trades";
import { surfacesRoute } from "./routes/surfaces";
import { sviHealthRoute } from "./routes/svi-health";
import { getRiskRules, getSourceStatuses } from "./services/dashboard-service";

function loadLocalEnv() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(currentDir, "../../../.env"),
    join(process.cwd(), ".env"),
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (!envPath) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

const port = Number(process.env.API_PORT ?? process.env.PORT ?? DEFAULT_API_PORT);

function setCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && SUPPORTED_WEB_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(req: IncomingMessage, res: ServerResponse, statusCode: number, payload: unknown) {
  setCors(req, res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function parseBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === "OPTIONS") {
      setCors(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `localhost:${port}`}`);
    if (url.pathname === "/api/health") {
      sendJson(req, res, 200, { status: "ok" });
      return;
    }
    if (url.pathname === "/api/overview") {
      sendJson(req, res, 200, await overviewRoute());
      return;
    }
    if (url.pathname === "/api/surfaces") {
      sendJson(req, res, 200, await surfacesRoute());
      return;
    }
    if (url.pathname === "/api/opportunities") {
      sendJson(req, res, 200, await opportunitiesRoute());
      return;
    }
    if (url.pathname === "/api/svi-health") {
      sendJson(req, res, 200, await sviHealthRoute());
      return;
    }
    if (url.pathname === "/api/paper-trades") {
      const body = req.method === "POST" ? await parseBody(req) : undefined;
      sendJson(req, res, 200, await paperTradesRoute(req.method ?? "GET", body));
      return;
    }
    if (url.pathname === "/api/risk-rules") {
      sendJson(req, res, 200, await getRiskRules());
      return;
    }
    if (url.pathname === "/api/source-statuses") {
      sendJson(req, res, 200, await getSourceStatuses());
      return;
    }

    sendJson(req, res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(req, res, 500, {
      error: "internal_error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

createServer(handleRequest).listen(port, () => {
  console.log(`Vol-Arb API listening on http://localhost:${port}`);
});
