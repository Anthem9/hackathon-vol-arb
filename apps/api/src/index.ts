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
import {
  bindDeepBookManagerToWallet,
  backfillDeepBookChainTransactions,
  buildDeepBookTradeIntent,
  getDeepBookChainTransactions,
  getDeepBookManagerBinding,
  getDeepBookPositionState,
  getDeepBookStatus,
  getDeepBookTestnetReadiness,
  recordDeepBookChainTransaction,
  reconcileRecentDeepBookChainTransactions,
} from "./services/deepbook-transaction-service";
import { createAlertOperatorAction } from "./services/alert-service";
import { getDashboardAlerts, getPersistenceStatus, getRiskRules, getSourceStatuses } from "./services/dashboard-service";
import { getApiHealth } from "./services/health-service";
import { getMaintenanceStatus, runMaintenanceOnce, startMaintenanceScheduler } from "./services/maintenance-service";
import { buildPolymarketCancelPreview, buildPolymarketOrderPreview, getPolymarketAccountState, getPolymarketTradingReadiness } from "./services/polymarket-trading-service";
import { checkDatabaseConnection } from "./db/postgres";

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
      sendJson(req, res, 200, await getApiHealth({ deep: url.searchParams.get("deep") === "1" }));
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
    if (url.pathname === "/api/alerts") {
      sendJson(req, res, 200, await getDashboardAlerts());
      return;
    }
    if (url.pathname === "/api/alerts/action") {
      const body = req.method === "POST" ? await parseBody(req) : undefined;
      sendJson(req, res, 200, await createAlertOperatorAction(body));
      return;
    }
    if (url.pathname === "/api/persistence") {
      sendJson(req, res, 200, await getPersistenceStatus());
      return;
    }
    if (url.pathname === "/api/persistence/check") {
      sendJson(req, res, 200, await checkDatabaseConnection());
      return;
    }
    if (url.pathname === "/api/maintenance/status") {
      sendJson(req, res, 200, getMaintenanceStatus());
      return;
    }
    if (url.pathname === "/api/maintenance/run") {
      if (req.method !== "POST") {
        sendJson(req, res, 405, { error: "method_not_allowed", message: "Use POST to run maintenance." });
        return;
      }
      sendJson(req, res, 200, await runMaintenanceOnce());
      return;
    }
    if (url.pathname === "/api/polymarket/trading-readiness") {
      sendJson(req, res, 200, await getPolymarketTradingReadiness());
      return;
    }
    if (url.pathname === "/api/polymarket/order-preview") {
      const body = req.method === "POST" ? await parseBody(req) : undefined;
      sendJson(req, res, 200, await buildPolymarketOrderPreview(body));
      return;
    }
    if (url.pathname === "/api/polymarket/cancel-preview") {
      const body = req.method === "POST" ? await parseBody(req) : undefined;
      sendJson(req, res, 200, await buildPolymarketCancelPreview(body));
      return;
    }
    if (url.pathname === "/api/polymarket/account") {
      sendJson(req, res, 200, await getPolymarketAccountState(url.searchParams.get("owner") ?? undefined));
      return;
    }
    if (url.pathname === "/api/deepbook/intent") {
      const body = req.method === "POST" ? await parseBody(req) : undefined;
      sendJson(req, res, 200, buildDeepBookTradeIntent(body));
      return;
    }
    if (url.pathname === "/api/deepbook/status") {
      sendJson(
        req,
        res,
        200,
        await getDeepBookStatus(url.searchParams.get("managerId") ?? undefined, url.searchParams.get("owner") ?? undefined),
      );
      return;
    }
    if (url.pathname === "/api/deepbook/manager-binding") {
      if (req.method === "POST") {
        sendJson(req, res, 200, await bindDeepBookManagerToWallet(await parseBody(req)));
        return;
      }
      sendJson(req, res, 200, await getDeepBookManagerBinding(url.searchParams.get("owner") ?? ""));
      return;
    }
    if (url.pathname === "/api/deepbook/readiness") {
      sendJson(req, res, 200, await getDeepBookTestnetReadiness());
      return;
    }
    if (url.pathname === "/api/deepbook/transactions") {
      const body = req.method === "POST" ? await parseBody(req) : undefined;
      sendJson(req, res, 200, req.method === "POST" ? await recordDeepBookChainTransaction(body) : await getDeepBookChainTransactions());
      return;
    }
    if (url.pathname === "/api/deepbook/reconcile") {
      const limit = Number(url.searchParams.get("limit") ?? 10);
      sendJson(req, res, 200, await reconcileRecentDeepBookChainTransactions(Number.isFinite(limit) ? Math.max(1, Math.min(25, Math.trunc(limit))) : 10));
      return;
    }
    if (url.pathname === "/api/deepbook/backfill") {
      const limit = Number(url.searchParams.get("limit") ?? 25);
      sendJson(
        req,
        res,
        200,
        await backfillDeepBookChainTransactions(url.searchParams.get("owner") ?? undefined, Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.trunc(limit))) : 25),
      );
      return;
    }
    if (url.pathname === "/api/deepbook/positions") {
      sendJson(req, res, 200, await getDeepBookPositionState());
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
  startMaintenanceScheduler();
  console.log(`Vol-Arb API listening on http://localhost:${port}`);
});
