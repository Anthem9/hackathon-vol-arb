import { Chain, ClobClient, createL2Headers, OrderType, Side, type ApiKeyCreds, type TickSize } from "@polymarket/clob-client-v2";
import { createWalletClient, custom } from "viem";
import { privateKeyToAccount } from "viem/accounts";

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

function polymarketClientChain() {
  return polymarketChainId() === 80002 ? Chain.AMOY : Chain.POLYGON;
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

function buildPolymarketWalletClient(walletAddress: string) {
  const privateKey = envValue("POLYMARKET_PRIVATE_KEY") || envValue("POLYGON_TEST_PRIVATE_KEY");
  if (!isPrivateKey(privateKey)) {
    throw new Error("POLYMARKET_PRIVATE_KEY or POLYGON_TEST_PRIVATE_KEY must be configured for authenticated CLOB reads.");
  }
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  if (walletAddress.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Configured Polymarket wallet ${walletAddress} does not match local signing key address ${account.address}.`);
  }

  return createWalletClient({
    account,
    transport: custom({
      request: async () => {
        throw new Error("Polygon RPC is not configured; authenticated CLOB reads only need local signer identity.");
      },
    }),
  });
}

function asStringHeaders(headers: Record<string, string | number | boolean>) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)]));
}

function getPolymarketCreds() {
  return {
    key: envValue("POLYMARKET_API_KEY"),
    secret: envValue("POLYMARKET_API_SECRET"),
    passphrase: envValue("POLYMARKET_API_PASSPHRASE"),
  } satisfies ApiKeyCreds;
}

function buildAuthenticatedPolymarketClient() {
  const walletAddress = envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  return new ClobClient({
    host: clobUrl(),
    chain: polymarketClientChain(),
    signer: buildPolymarketWalletClient(walletAddress),
    creds: getPolymarketCreds(),
    funderAddress: envValue("POLYMARKET_FUNDER_ADDRESS") || undefined,
    throwOnError: true,
  });
}

function manualOrderConfirmationText() {
  return envValue("POLYMARKET_ORDER_CONFIRM_TEXT") || "I understand this submits a real Polymarket order";
}

function manualCancelConfirmationText() {
  return envValue("POLYMARKET_CANCEL_CONFIRM_TEXT") || "I understand this cancels a real Polymarket order";
}

function maxLiveOrderNotionalUsd() {
  const value = Number(envValue("POLYMARKET_MAX_LIVE_ORDER_USD") || "5");
  return Number.isFinite(value) && value > 0 ? value : 5;
}

function asTickSize(value: unknown): TickSize {
  const candidate = asString(value);
  return candidate === "0.1" || candidate === "0.01" || candidate === "0.001" || candidate === "0.0001" ? candidate : "0.01";
}

function asOrderType(value: unknown): OrderType.GTC | OrderType.GTD {
  return asString(value).toUpperCase() === OrderType.GTD ? OrderType.GTD : OrderType.GTC;
}

function normalizeOpenOrdersPayload(payload: unknown) {
  if (Array.isArray(payload)) return payload.map(asRecord);
  const record = asRecord(payload);
  if (Array.isArray(record.data)) return record.data.map(asRecord);
  return [];
}

function decimalFromAtomic(rawValue: string, decimals = 6) {
  const raw = rawValue.trim();
  if (!/^\d+$/.test(raw)) return Number(raw);
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return Number(`${whole}${fraction ? `.${fraction}` : ""}`);
}

function normalizeBalanceAllowancePayload(payload: unknown) {
  const record = asRecord(payload);
  const rawBalance = asString(record.balance);
  const allowances = asRecord(record.allowances);
  return {
    balance: rawBalance ? decimalFromAtomic(rawBalance) : 0,
    rawBalance,
    allowances: Object.fromEntries(Object.entries(allowances).map(([key, value]) => [key, String(value)])),
  };
}

function maxAllowanceValue(allowances: Record<string, string>) {
  return Math.max(0, ...Object.values(allowances).map((value) => decimalFromAtomic(value)));
}

async function getAuthenticatedOpenOrders() {
  const walletAddress = envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  const apiKey = envValue("POLYMARKET_API_KEY");
  const apiSecret = envValue("POLYMARKET_API_SECRET");
  const apiPassphrase = envValue("POLYMARKET_API_PASSPHRASE");

  if (!isPolygonAddress(walletAddress) || !apiKey || !apiSecret || !apiPassphrase) {
    return { ready: false, payload: null, error: "L2 credentials are not configured." };
  }

  const endpoint = "/data/orders";
  const url = queryUrl(clobUrl(), endpoint, { next_cursor: "MA==" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const headers = await createL2Headers(
      buildPolymarketWalletClient(walletAddress),
      { key: apiKey, secret: apiSecret, passphrase: apiPassphrase } satisfies ApiKeyCreds,
      { method: "GET", requestPath: endpoint },
    );
    const response = await fetch(url, {
      signal: controller.signal,
      headers: asStringHeaders(headers),
    });
    if (!response.ok) return { ready: true, payload: null, error: `CLOB authenticated endpoint returned ${response.status}.` };
    return { ready: true, payload: await response.json(), error: null };
  } catch (error) {
    return { ready: true, payload: null, error: error instanceof Error ? error.message : "CLOB authenticated endpoint is unavailable." };
  } finally {
    clearTimeout(timeout);
  }
}

async function getAuthenticatedBalanceAllowance() {
  const walletAddress = envValue("POLYMARKET_WALLET_ADDRESS") || envValue("POLYGON_TEST_ADDRESS");
  const apiKey = envValue("POLYMARKET_API_KEY");
  const apiSecret = envValue("POLYMARKET_API_SECRET");
  const apiPassphrase = envValue("POLYMARKET_API_PASSPHRASE");

  if (!isPolygonAddress(walletAddress) || !apiKey || !apiSecret || !apiPassphrase) {
    return { ready: false, payload: null, error: "L2 credentials are not configured." };
  }

  const endpoint = "/balance-allowance";
  const url = queryUrl(clobUrl(), endpoint, { asset_type: "COLLATERAL" });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const headers = await createL2Headers(
      buildPolymarketWalletClient(walletAddress),
      { key: apiKey, secret: apiSecret, passphrase: apiPassphrase } satisfies ApiKeyCreds,
      { method: "GET", requestPath: endpoint },
    );
    const response = await fetch(url, {
      signal: controller.signal,
      headers: asStringHeaders(headers),
    });
    if (!response.ok) return { ready: true, payload: null, error: `CLOB balance/allowance endpoint returned ${response.status}.` };
    return { ready: true, payload: await response.json(), error: null };
  } catch (error) {
    return { ready: true, payload: null, error: error instanceof Error ? error.message : "CLOB balance/allowance endpoint is unavailable." };
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
  let accountPreflight = {
    ready: readiness.capabilities.authenticatedRequests,
    balance: null as number | null,
    maxAllowance: null as number | null,
    detail: readiness.capabilities.authenticatedRequests
      ? "Account balance and allowance preflight has not run yet."
      : "Account balance and allowance preflight requires configured L2 credentials.",
  };

  if (readiness.capabilities.authenticatedRequests && validationBlockers.length === 0) {
    const balanceAllowanceResult = await getAuthenticatedBalanceAllowance();
    if (balanceAllowanceResult.error || !balanceAllowanceResult.payload) {
      accountPreflight = {
        ready: false,
        balance: null,
        maxAllowance: null,
        detail: balanceAllowanceResult.error ?? "Balance and allowance payload is empty.",
      };
      blockers.push(accountPreflight.detail);
    } else {
      const collateral = normalizeBalanceAllowancePayload(balanceAllowanceResult.payload);
      const maxAllowance = maxAllowanceValue(collateral.allowances);
      accountPreflight = {
        ready: true,
        balance: collateral.balance,
        maxAllowance,
        detail: `Collateral balance $${collateral.balance.toFixed(2)}; max allowance $${maxAllowance.toFixed(2)}.`,
      };
      if (side === "buy" && maxLoss > collateral.balance + 0.000001) {
        blockers.push(`Collateral balance $${collateral.balance.toFixed(2)} is below max loss $${maxLoss.toFixed(2)}.`);
      }
      if (side === "buy" && maxLoss > maxAllowance + 0.000001) {
        blockers.push(`Collateral allowance $${maxAllowance.toFixed(2)} is below max loss $${maxLoss.toFixed(2)}.`);
      }
      if (side === "sell") {
        blockers.push("Sell orders require conditional token balance and allowance preflight before live submission.");
      }
    }
  }

  return {
    network: polymarketNetwork(),
    chainId: polymarketChainId(),
    safeMode: readiness.safeMode,
    orderSubmissionReady: readiness.orderSubmissionReady && blockers.length === 0,
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
    accountPreflight,
    blockers,
    nextAction:
      blockers.length > 0
        ? "Resolve blockers before enabling manual-confirm order submission."
        : "Manual confirmation controls are required before live order submission.",
  };
}

export async function executePolymarketOrder(body: unknown) {
  const input = asRecord(body);
  const confirmation = asString(input.confirmation);
  const tickSize = asTickSize(input.tickSize);
  const orderType = asOrderType(input.orderType);
  const postOnly = input.postOnly === undefined ? true : Boolean(input.postOnly);
  const preview = await buildPolymarketOrderPreview(body);
  const blockers = [...preview.blockers];
  const maxNotional = maxLiveOrderNotionalUsd();

  if (confirmation !== manualOrderConfirmationText()) blockers.push("Manual order confirmation text does not match.");
  if (preview.preview.notional > maxNotional) blockers.push(`Order notional ${preview.preview.notional.toFixed(2)} exceeds POLYMARKET_MAX_LIVE_ORDER_USD=${maxNotional}.`);

  if (blockers.length > 0 || !preview.orderSubmissionReady) {
    return {
      network: polymarketNetwork(),
      chainId: polymarketChainId(),
      submitted: false,
      executionEnabled: false,
      preview: preview.preview,
      blockers,
      nextAction: "Resolve blockers and repeat preview before submitting a live Polymarket order.",
    };
  }

  const client = buildAuthenticatedPolymarketClient();
  const response = await client.createAndPostOrder(
    {
      tokenID: preview.preview.tokenId,
      price: preview.preview.price ?? 0,
      side: preview.preview.side === "sell" ? Side.SELL : Side.BUY,
      size: preview.preview.size ?? 0,
    },
    { tickSize },
    orderType,
    postOnly,
  );

  return {
    network: polymarketNetwork(),
    chainId: polymarketChainId(),
    submitted: true,
    executionEnabled: true,
    preview: preview.preview,
    orderType,
    postOnly,
    response,
    blockers: [],
    nextAction: "Refresh authenticated open orders and account positions.",
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
      balanceAllowance: {
        ready: readiness.capabilities.authenticatedRequests,
        enabled: false,
        detail: readiness.capabilities.authenticatedRequests
          ? "Balance and allowance reads require backend L2 request signing."
          : "Balance and allowance reads require POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE.",
        collateral: null,
      },
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
        detail: "Cancel execution is implemented but disabled unless live trading, manual confirmation, and open-order matching all pass.",
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
    ? await getAuthenticatedOpenOrders()
    : { ready: false, payload: null, error: "Open-order reads require POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE." };
  const balanceAllowanceResult = readiness.capabilities.authenticatedRequests
    ? await getAuthenticatedBalanceAllowance()
    : { ready: false, payload: null, error: "Balance and allowance reads require POLYMARKET_API_KEY, POLYMARKET_API_SECRET, and POLYMARKET_API_PASSPHRASE." };
  const orders = normalizeOpenOrdersPayload(ordersResult.payload);
  const collateral = balanceAllowanceResult.payload ? normalizeBalanceAllowancePayload(balanceAllowanceResult.payload) : null;
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
      detail: ordersResult.error ?? `Fetched ${orders.length} authenticated open order(s) with official CLOB L2 signing.`,
    },
    balanceAllowance: {
      ready: readiness.capabilities.authenticatedRequests,
      enabled: readiness.capabilities.authenticatedRequests && balanceAllowanceResult.error === null,
      detail: balanceAllowanceResult.error ?? `Fetched collateral balance and ${Object.keys(collateral?.allowances ?? {}).length} allowance entries with official CLOB L2 signing.`,
      collateral,
    },
    cancelOrders: {
      ready: readiness.capabilities.authenticatedRequests && readiness.liveTradingEnabled,
      enabled: false,
      detail: "Cancel execution is implemented but disabled unless live trading, manual confirmation, and open-order matching all pass.",
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

export async function executePolymarketCancel(body: unknown) {
  const input = asRecord(body);
  const confirmation = asString(input.confirmation);
  const preview = await buildPolymarketCancelPreview(body);
  const blockers = [...preview.blockers];

  if (confirmation !== manualCancelConfirmationText()) blockers.push("Manual cancel confirmation text does not match.");

  if (blockers.length > 0 || !preview.cancelReady) {
    return {
      network: polymarketNetwork(),
      chainId: polymarketChainId(),
      submitted: false,
      executionEnabled: false,
      orderId: preview.orderId,
      order: preview.order,
      blockers,
      nextAction: "Resolve blockers and repeat cancel preview before submitting a live cancel.",
    };
  }

  const client = buildAuthenticatedPolymarketClient();
  const response = await client.cancelOrder({ orderID: preview.orderId });

  return {
    network: polymarketNetwork(),
    chainId: polymarketChainId(),
    submitted: true,
    executionEnabled: true,
    orderId: preview.orderId,
    order: preview.order,
    response,
    blockers: [],
    nextAction: "Refresh authenticated open orders.",
  };
}
