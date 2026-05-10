import { createHmac } from "node:crypto";

type Check = {
  label: string;
  ready: boolean;
  detail: string;
};

function envValue(name: string) {
  return process.env[name]?.trim() ?? "";
}

function clobUrl() {
  return envValue("POLYMARKET_API_BASE") || "https://clob.polymarket.com";
}

function gammaUrl() {
  return envValue("POLYMARKET_GAMMA_API_BASE") || "https://gamma-api.polymarket.com";
}

function dataUrl() {
  return envValue("POLYMARKET_DATA_API_BASE") || "https://data-api.polymarket.com";
}

function polymarketChainId() {
  const value = Number(envValue("POLYMARKET_CHAIN_ID") || "137");
  return value === 80002 ? 80002 : 137;
}

function polymarketNetwork() {
  return polymarketChainId() === 80002 ? "polygon-amoy" : "polygon";
}

function isPolygonAddress(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isPrivateKey(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function hasValue(value: string) {
  return value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  return Number.NaN;
}

function decodeBase64Secret(secret: string) {
  const normalized = secret.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function buildPolyHmacSignature(secret: string, timestamp: number, method: string, requestPath: string, body?: string) {
  const message = `${timestamp}${method}${requestPath}${body ?? ""}`;
  return createHmac("sha256", decodeBase64Secret(secret)).update(message).digest("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

function queryUrl(base: string, path: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

async function getJson(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Polymarket Data API returned ${response.status}.`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getAuthenticatedClobJson(path: string, params: Record<string, string | number | boolean | undefined>) {
  const walletAddress = envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  const apiKey = envValue("POLYMARKET_API_KEY");
  const apiSecret = envValue("POLYMARKET_API_SECRET");
  const apiPassphrase = envValue("POLYMARKET_API_PASSPHRASE");

  if (!isPolygonAddress(walletAddress) || !apiKey || !apiSecret || !apiPassphrase) {
    return { ready: false, payload: null, error: "L2 credentials are not configured." };
  }

  const url = queryUrl(clobUrl(), path, params);
  const requestPath = `${url.pathname}${url.search}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildPolyHmacSignature(apiSecret, timestamp, "GET", requestPath);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        POLY_ADDRESS: walletAddress,
        POLY_SIGNATURE: signature,
        POLY_TIMESTAMP: String(timestamp),
        POLY_API_KEY: apiKey,
        POLY_PASSPHRASE: apiPassphrase,
      },
    });
    if (!response.ok) return { ready: true, payload: null, error: `CLOB authenticated endpoint returned ${response.status}.` };
    return { ready: true, payload: await response.json(), error: null };
  } catch (error) {
    return { ready: true, payload: null, error: error instanceof Error ? error.message : "CLOB authenticated endpoint is unavailable." };
  } finally {
    clearTimeout(timeout);
  }
}

async function clobHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${clobUrl()}/`, { signal: controller.signal });
    return {
      ready: response.ok,
      detail: response.ok ? "CLOB public endpoint is reachable." : `CLOB public endpoint returned ${response.status}.`,
    };
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error ? error.message : "CLOB public endpoint is unavailable.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getPolymarketTradingReadiness() {
  const walletAddress = envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  const funderAddress = envValue("POLYMARKET_FUNDER_ADDRESS");
  const privateKey = envValue("POLYMARKET_PRIVATE_KEY") || envValue("POLYGON_TEST_PRIVATE_KEY");
  const apiKey = envValue("POLYMARKET_API_KEY");
  const apiSecret = envValue("POLYMARKET_API_SECRET");
  const apiPassphrase = envValue("POLYMARKET_API_PASSPHRASE");
  const signatureType = envValue("POLYMARKET_SIGNATURE_TYPE") || "0";
  const chainId = polymarketChainId();
  const liveTradingChainReady = chainId === 137;
  const liveTradingEnabled = envValue("POLYMARKET_ENABLE_LIVE_TRADING") === "true";
  const health = await clobHealth();

  const checks: Check[] = [
    {
      label: "Public CLOB",
      ready: health.ready,
      detail: health.detail,
    },
    {
      label: "Wallet Address",
      ready: isPolygonAddress(walletAddress),
      detail: walletAddress ? "Wallet address is configured and has Polygon format." : "POLYMARKET_WALLET_ADDRESS or POLYGON_TEST_ADDRESS is missing.",
    },
    {
      label: "Local Order Signing",
      ready: isPrivateKey(privateKey),
      detail: privateKey ? "Private key format is valid; value is never returned by the API." : "POLYMARKET_PRIVATE_KEY or POLYGON_TEST_PRIVATE_KEY is missing.",
    },
    {
      label: "Polymarket Chain",
      ready: chainId === 137 || chainId === 80002,
      detail: chainId === 137 ? "POLYMARKET_CHAIN_ID=137." : "POLYMARKET_CHAIN_ID=80002; use only for wallet/RPC signing rehearsal, not live Polymarket trading.",
    },
    {
      label: "L2 API Key",
      ready: hasValue(apiKey),
      detail: apiKey ? "POLYMARKET_API_KEY is configured." : "POLYMARKET_API_KEY is missing.",
    },
    {
      label: "L2 API Secret",
      ready: hasValue(apiSecret),
      detail: apiSecret ? "POLYMARKET_API_SECRET is configured." : "POLYMARKET_API_SECRET is missing.",
    },
    {
      label: "L2 Passphrase",
      ready: hasValue(apiPassphrase),
      detail: apiPassphrase ? "POLYMARKET_API_PASSPHRASE is configured." : "POLYMARKET_API_PASSPHRASE is missing.",
    },
    {
      label: "Funder",
      ready: !funderAddress || isPolygonAddress(funderAddress),
      detail: funderAddress ? "POLYMARKET_FUNDER_ADDRESS has Polygon format." : "Optional unless using a proxy/funder wallet.",
    },
    {
      label: "Live Trading Flag",
      ready: liveTradingEnabled,
      detail: liveTradingEnabled ? "POLYMARKET_ENABLE_LIVE_TRADING=true." : "Live order submission is disabled.",
    },
  ];

  const credentialsReady = checks
    .filter((check) => ["Wallet Address", "Local Order Signing", "L2 API Key", "L2 API Secret", "L2 Passphrase"].includes(check.label))
    .every((check) => check.ready);
  const orderSubmissionReady = liveTradingEnabled && liveTradingChainReady && credentialsReady && health.ready;
  const blockers = checks.filter((check) => !check.ready && check.label !== "Live Trading Flag" && check.label !== "Funder").map((check) => check.detail);
  if (!liveTradingEnabled) blockers.push("POLYMARKET_ENABLE_LIVE_TRADING is not true; order submission remains disabled.");
  if (!liveTradingChainReady) blockers.push("Polymarket live trading requires POLYMARKET_CHAIN_ID=137.");

  return {
    clobUrl: clobUrl(),
    gammaUrl: gammaUrl(),
    dataUrl: dataUrl(),
    network: polymarketNetwork(),
    chainId,
    signatureType,
    liveTradingEnabled,
    orderSubmissionReady,
    safeMode: orderSubmissionReady ? "manual_confirm_required" : "read_only",
    checks,
    blockers,
    capabilities: {
      publicMarketData: health.ready,
      authenticatedRequests: credentialsReady,
      localOrderSigning: isPrivateKey(privateKey),
      orderSubmission: orderSubmissionReady,
    },
  };
}

export async function buildPolymarketOrderPreview(body: unknown) {
  const input = asRecord(body);
  const market = asString(input.market);
  const tokenId = asString(input.tokenId);
  const side = asString(input.side).toLowerCase() === "sell" ? "sell" : "buy";
  const price = asNumber(input.price);
  const size = asNumber(input.size);
  const readiness = await getPolymarketTradingReadiness();
  const validationBlockers: string[] = [];

  if (!market) validationBlockers.push("market is required.");
  if (!tokenId) validationBlockers.push("tokenId is required.");
  if (!Number.isFinite(price) || price <= 0 || price >= 1) validationBlockers.push("price must be between 0 and 1.");
  if (!Number.isFinite(size) || size <= 0) validationBlockers.push("size must be positive.");

  const notional = Number.isFinite(price) && Number.isFinite(size) ? price * size : 0;
  const maxLoss = side === "buy" ? notional : Number.isFinite(price) && Number.isFinite(size) ? (1 - price) * size : 0;
  const maxProfit = side === "buy" ? Number.isFinite(price) && Number.isFinite(size) ? (1 - price) * size : 0 : notional;
  const blockers = [...validationBlockers, ...readiness.blockers];

  return {
    network: polymarketNetwork(),
    chainId: polymarketChainId(),
    safeMode: readiness.safeMode,
    orderSubmissionReady: readiness.orderSubmissionReady && validationBlockers.length === 0,
    liveTradingEnabled: readiness.liveTradingEnabled,
    preview: {
      market,
      tokenId,
      side,
      price: Number.isFinite(price) ? price : null,
      size: Number.isFinite(size) ? size : null,
      notional,
      maxLoss,
      maxProfit,
    },
    blockers,
    nextAction:
      blockers.length > 0
        ? "Resolve blockers before enabling manual-confirm order submission."
        : "Manual confirmation controls are required before live order submission.",
  };
}

function normalizePolymarketOrder(order: Record<string, unknown>) {
  return {
    id: asString(order.id),
    status: asString(order.status),
    market: asString(order.market),
    assetId: asString(order.asset_id),
    side: asString(order.side),
    originalSize: asNumber(order.original_size) || 0,
    sizeMatched: asNumber(order.size_matched) || 0,
    price: asNumber(order.price) || 0,
    outcome: asString(order.outcome),
    orderType: asString(order.order_type),
    createdAt: asNumber(order.created_at) || 0,
  };
}

export async function getPolymarketAccountState(owner?: string) {
  const walletAddress = owner?.trim() || envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  const readiness = await getPolymarketTradingReadiness();
  const blockers: string[] = [];

  if (!isPolygonAddress(walletAddress)) {
    blockers.push("A valid POLYMARKET_WALLET_ADDRESS or owner query parameter is required.");
    return {
      network: polymarketNetwork(),
      chainId: polymarketChainId(),
      dataUrl: dataUrl(),
      walletAddress: walletAddress || null,
      positions: [],
      orders: [],
      totals: { currentValue: 0, initialValue: 0, cashPnl: 0, realizedPnl: 0 },
      openOrders: {
        ready: readiness.capabilities.authenticatedRequests,
        enabled: false,
        detail: readiness.capabilities.authenticatedRequests
          ? "Open-order reads require backend L2 request signing; submission is not enabled in this build."
          : "Open-order reads require POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE.",
      },
      cancelOrders: {
        ready: readiness.capabilities.authenticatedRequests && readiness.liveTradingEnabled,
        enabled: false,
        detail: "Cancel endpoints remain disabled until explicit backend HMAC signing and manual confirmation controls are implemented.",
      },
      blockers,
    };
  }

  const positionsPayload = await getJson(
    queryUrl(dataUrl(), "positions", {
      user: walletAddress,
      limit: 100,
      sizeThreshold: 0,
    }),
  );
  const positions = Array.isArray(positionsPayload) ? positionsPayload.map(asRecord) : [];
  const ordersResult = readiness.capabilities.authenticatedRequests
    ? await getAuthenticatedClobJson("data/orders", { limit: 100 })
    : { ready: false, payload: null, error: "Open-order reads require POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE." };
  const ordersPayload = asRecord(ordersResult.payload);
  const orders = Array.isArray(ordersPayload.data) ? ordersPayload.data.map(asRecord) : [];
  const totals = positions.reduce<{ currentValue: number; initialValue: number; cashPnl: number; realizedPnl: number }>(
    (sum, position) => {
      sum.currentValue += asNumber(position.currentValue) || 0;
      sum.initialValue += asNumber(position.initialValue) || 0;
      sum.cashPnl += asNumber(position.cashPnl) || 0;
      sum.realizedPnl += asNumber(position.realizedPnl) || 0;
      return sum;
    },
    { currentValue: 0, initialValue: 0, cashPnl: 0, realizedPnl: 0 },
  );

  return {
    network: polymarketNetwork(),
    chainId: polymarketChainId(),
    dataUrl: dataUrl(),
    walletAddress,
    positions: positions.slice(0, 25).map((position) => ({
      asset: asString(position.asset),
      conditionId: asString(position.conditionId),
      title: asString(position.title),
      slug: asString(position.slug),
      outcome: asString(position.outcome),
      size: asNumber(position.size) || 0,
      avgPrice: asNumber(position.avgPrice) || 0,
      curPrice: asNumber(position.curPrice) || 0,
      currentValue: asNumber(position.currentValue) || 0,
      initialValue: asNumber(position.initialValue) || 0,
      cashPnl: asNumber(position.cashPnl) || 0,
      realizedPnl: asNumber(position.realizedPnl) || 0,
      redeemable: Boolean(position.redeemable),
      mergeable: Boolean(position.mergeable),
      endDate: asString(position.endDate),
    })),
    totals,
    orders: orders.slice(0, 25).map(normalizePolymarketOrder),
    openOrders: {
      ready: readiness.capabilities.authenticatedRequests,
      enabled: readiness.capabilities.authenticatedRequests && ordersResult.error === null,
      detail: ordersResult.error ?? `Fetched ${orders.length} authenticated open order(s) with backend L2 HMAC signing.`,
    },
    cancelOrders: {
      ready: readiness.capabilities.authenticatedRequests && readiness.liveTradingEnabled,
      enabled: false,
      detail: "Cancel endpoints remain disabled until explicit backend HMAC signing and manual confirmation controls are implemented.",
    },
    blockers,
  };
}

export async function buildPolymarketCancelPreview(body: unknown) {
  const orderId = asString(asRecord(body).orderId);
  const readiness = await getPolymarketTradingReadiness();
  const accountState = await getPolymarketAccountState();
  const matchedOrder = accountState.orders.find((order) => order.id === orderId) ?? null;
  const blockers: string[] = [];

  if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) blockers.push("orderId must be a 32-byte order hash.");
  if (!readiness.capabilities.authenticatedRequests) blockers.push("L2 API credentials are required before cancel preview can verify open orders.");
  if (!matchedOrder && orderId) blockers.push("Order is not present in the authenticated open-order set.");
  if (!readiness.liveTradingEnabled) blockers.push("POLYMARKET_ENABLE_LIVE_TRADING is not true; cancel execution remains disabled.");

  return {
    network: polymarketNetwork(),
    chainId: polymarketChainId(),
    safeMode: "read_only",
    cancelReady: blockers.length === 0,
    cancelExecutionEnabled: false,
    orderId,
    order: matchedOrder,
    blockers,
    nextAction:
      blockers.length > 0
        ? "Resolve blockers before enabling backend cancel execution."
        : "Backend cancel execution still requires an explicit implementation and manual confirmation gate.",
  };
}
