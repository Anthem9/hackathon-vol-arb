import type {
  AlertEvent,
  DataMode,
  DataSourceStatus,
  ExecutableEdge,
  Overview,
  PersistenceStatus,
  RiskRule,
  SviHealthReport,
  VolSurface,
} from "@vol-arb/core";

function apiBaseUrl() {
  if (typeof window === "undefined") {
    return process.env.API_INTERNAL_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  }
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

async function withApiTimeout<T>(request: (signal: AbortSignal) => Promise<T>) {
  const timeoutMs = Number(process.env.API_REQUEST_TIMEOUT_MS ?? 10000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000);
  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await withApiTimeout((signal) => fetch(`${apiBaseUrl()}${path}`, { cache: "no-store", signal }));
  if (!response.ok) {
    throw new Error(`API ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await withApiTimeout((signal) => fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  }));
  if (!response.ok) {
    throw new Error(`API ${path} failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type DashboardApiData = {
  overview: Overview;
  surfaces: VolSurface[];
  opportunities: ExecutableEdge[];
  sviHealth: SviHealthReport[];
  riskRules: RiskRule[];
  sourceStatuses: DataSourceStatus[];
  alerts: AlertEvent[];
  persistence: PersistenceStatus;
  mode: DataMode;
};

export async function fetchDashboardData(): Promise<DashboardApiData> {
  const [overview, surfaces, opportunities, sviHealth, riskRules, sourceStatusPayload, alerts, persistence] = await Promise.all([
    getJson<Overview>("/api/overview"),
    getJson<VolSurface[]>("/api/surfaces"),
    getJson<ExecutableEdge[]>("/api/opportunities"),
    getJson<SviHealthReport[]>("/api/svi-health"),
    getJson<RiskRule[]>("/api/risk-rules"),
    getJson<Pick<DashboardApiData, "mode" | "sourceStatuses" | "persistence">>("/api/source-statuses"),
    getJson<AlertEvent[]>("/api/alerts"),
    getJson<PersistenceStatus>("/api/persistence"),
  ]);
  return {
    overview,
    surfaces,
    opportunities,
    sviHealth,
    riskRules,
    alerts,
    persistence: sourceStatusPayload.persistence ?? persistence,
    mode: sourceStatusPayload.mode,
    sourceStatuses: sourceStatusPayload.sourceStatuses,
  };
}

export async function createDeepBookIntent(payload: Record<string, unknown>) {
  return postJson<{
    network: string;
    safeMode: string;
    action: string;
    description: string;
    calls: Array<Record<string, unknown>>;
  }>("/api/deepbook/intent", payload);
}

export type DeepBookChainTransaction = {
  digest: string;
  action: "create_manager" | "deposit_quote" | "mint_binary" | "redeem_binary" | "withdraw_quote";
  status: "submitted" | "success" | "failed";
  lifecycleStatus: "pending" | "submitted" | "confirmed" | "indexed" | "reconciled" | "failed";
  owner?: string;
  managerId?: string;
  oracleId?: string;
  expiry?: number;
  strike?: string;
  direction?: string;
  quantity?: string;
  payload: Record<string, unknown>;
  failureReason?: string;
  observedAt: number;
  confirmedAt?: number;
  indexedAt?: number;
  reconciledAt?: number;
  createdAt: number;
};

export async function postAlertAction(payload: { alertId: string; action: "resolve" | "silence"; reason?: string }) {
  return postJson<{ alertId: string; action: "resolve" | "silence"; reason?: string; createdAt: number }>("/api/alerts/action", payload);
}

export type DeepBookManagerSummary = {
  manager_id: string;
  owner: string;
  balances: Array<{ quote_asset: string; balance: number }>;
  trading_balance: number;
  open_exposure: number;
  redeemable_value: number;
  realized_pnl: number;
  unrealized_pnl: number;
  account_value: number;
  open_positions: number;
  awaiting_settlement_positions: number;
};

export type DeepBookStatus = {
  network: "testnet";
  packageId: string;
  predictObjectId: string;
  quoteAssetType: string;
  quoteAssetSymbol: string;
  clockObjectId: string;
  configuredManagerId: string;
  walletBinding: DeepBookWalletManagerBinding | null;
  managerSummary: DeepBookManagerSummary | null;
  managerError: string | null;
  readiness: {
    hasManager: boolean;
    hasQuoteBalance: boolean;
    managerBalance: number;
    nextAction: "create_manager" | "verify_manager" | "deposit_quote" | "ready_to_mint";
  };
};

export type DeepBookWalletManagerBinding = {
  network: "testnet";
  owner: string;
  managerId: string;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export type DeepBookTestnetReadiness = {
  network: "testnet";
  address: string;
  managerId: string;
  packageId: string;
  predictObjectId: string;
  quoteAssetType: string;
  balances: {
    suiMist: string;
    sui: number;
    walletQuoteBaseUnits: string;
    walletQuote: number;
    walletQuoteCoinObjects: number;
    managerQuoteBaseUnits: number;
    managerQuote: number;
  };
  manager: {
    configured: boolean;
    found: boolean;
    owner: string | null;
    ownerMatchesConfiguredAddress: boolean;
    error: string | null;
  };
  oracleCandidates: Array<{
    oracleId: string;
    predictId: string;
    expiry: number;
    minStrike: number;
    tickSize: number;
    status: string;
  }>;
  readiness: {
    canDepositDryRun: boolean;
    canMintDryRun: boolean;
    blockers: string[];
    warnings: string[];
    nextAction: "wait_for_dusdc" | "deposit_quote" | "dry_run_mint";
  };
};

export type DeepBookPositionState = {
  network: "testnet";
  managerId: string;
  managerSummary: DeepBookManagerSummary | null;
  managerError: string | null;
  positions: Array<{
    id: string;
    lifecycle: "open" | "expired" | "pending_settlement" | "redeemable" | "redeemed" | "open_unattributed";
    digest: string | null;
    managerId?: string | null;
    oracleId?: string | null;
    expiry?: number | null;
    strike?: string | null;
    displayStrike?: unknown;
    direction?: string | null;
    quantity?: string | null;
    createdAt: number;
    redeemReady: boolean;
    redeemBlockedReason: string | null;
  }>;
  transactions: DeepBookChainTransaction[];
  lifecycle: {
    hasPersistedMint: boolean;
    openPositions: number;
    awaitingSettlementPositions: number;
    redeemableValue: number;
    canWithdrawQuote: boolean;
  };
};

export type PolymarketTradingReadiness = {
  clobUrl: string;
  gammaUrl: string;
  dataUrl: string;
  network: "polygon";
  signatureType: string;
  liveTradingEnabled: boolean;
  orderSubmissionReady: boolean;
  safeMode: "read_only" | "manual_confirm_required";
  checks: Array<{
    label: string;
    ready: boolean;
    detail: string;
  }>;
  blockers: string[];
  capabilities: {
    publicMarketData: boolean;
    authenticatedRequests: boolean;
    localOrderSigning: boolean;
    orderSubmission: boolean;
  };
};

export type PolymarketAccountState = {
  network: "polygon";
  dataUrl: string;
  walletAddress: string | null;
  positions: Array<{
    asset: string;
    conditionId: string;
    title: string;
    slug: string;
    outcome: string;
    size: number;
    avgPrice: number;
    curPrice: number;
    currentValue: number;
    initialValue: number;
    cashPnl: number;
    realizedPnl: number;
    redeemable: boolean;
    mergeable: boolean;
    endDate: string;
  }>;
  orders: Array<{
    id: string;
    status: string;
    market: string;
    assetId: string;
    side: string;
    originalSize: number;
    sizeMatched: number;
    price: number;
    outcome: string;
    orderType: string;
    createdAt: number;
  }>;
  totals: {
    currentValue: number;
    initialValue: number;
    cashPnl: number;
    realizedPnl: number;
  };
  openOrders: {
    ready: boolean;
    enabled: boolean;
    detail: string;
  };
  cancelOrders: {
    ready: boolean;
    enabled: boolean;
    detail: string;
  };
  blockers: string[];
};

export type PolymarketOrderPreview = {
  network: "polygon";
  safeMode: "read_only" | "manual_confirm_required";
  orderSubmissionReady: boolean;
  liveTradingEnabled: boolean;
  preview: {
    market: string;
    tokenId: string;
    side: "buy" | "sell";
    price: number | null;
    size: number | null;
    notional: number;
    maxLoss: number;
    maxProfit: number;
  };
  blockers: string[];
  nextAction: string;
};

export type PolymarketCancelPreview = {
  network: "polygon";
  safeMode: "read_only";
  cancelReady: boolean;
  cancelExecutionEnabled: boolean;
  orderId: string;
  order: PolymarketAccountState["orders"][number] | null;
  blockers: string[];
  nextAction: string;
};

export type MaintenanceRun = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "success" | "partial" | "failed";
  tasks: Array<{
    name: string;
    status: "success" | "skipped" | "failed";
    detail: string;
    startedAt: number;
    finishedAt: number;
  }>;
};

export type MaintenanceStatus = {
  schedulerEnabled: boolean;
  schedulerStarted: boolean;
  intervalMs: number;
  taskTimeoutMs?: number;
  running: boolean;
  lastRun: MaintenanceRun | null;
};

export async function fetchDeepBookStatus(managerId?: string, owner?: string): Promise<DeepBookStatus> {
  const params = new URLSearchParams();
  if (managerId) params.set("managerId", managerId);
  if (owner) params.set("owner", owner);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return getJson<DeepBookStatus>(`/api/deepbook/status${query}`);
}

export async function fetchDeepBookManagerBinding(owner: string) {
  return getJson<{ binding: DeepBookWalletManagerBinding | null }>(`/api/deepbook/manager-binding?owner=${encodeURIComponent(owner)}`);
}

export async function bindDeepBookManager(payload: { owner: string; managerId: string; source?: string }) {
  return postJson<{ binding: DeepBookWalletManagerBinding; managerSummary: DeepBookManagerSummary }>("/api/deepbook/manager-binding", payload);
}

export async function fetchDeepBookReadiness(): Promise<DeepBookTestnetReadiness> {
  return getJson<DeepBookTestnetReadiness>("/api/deepbook/readiness");
}

export async function fetchDeepBookPositions(): Promise<DeepBookPositionState> {
  return getJson<DeepBookPositionState>("/api/deepbook/positions");
}

export async function recordDeepBookTransaction(payload: Record<string, unknown>) {
  return postJson<{ event: DeepBookChainTransaction; persistence: PersistenceStatus }>("/api/deepbook/transactions", payload);
}

export async function reconcileDeepBookTransactions(limit = 10) {
  return getJson<{ reconciled: DeepBookChainTransaction[]; errors: Array<{ digest: string; message: string }> }>(`/api/deepbook/reconcile?limit=${limit}`);
}

export async function backfillDeepBookTransactions(owner?: string, limit = 25) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (owner) params.set("owner", owner);
  return getJson<{ owner: string; recovered: DeepBookChainTransaction[]; skipped: Array<{ digest: string; reason: string }> }>(`/api/deepbook/backfill?${params.toString()}`);
}

export async function fetchPolymarketTradingReadiness(): Promise<PolymarketTradingReadiness> {
  return getJson<PolymarketTradingReadiness>("/api/polymarket/trading-readiness");
}

export async function previewPolymarketOrder(payload: { market: string; tokenId: string; side: "buy" | "sell"; price: string; size: string }) {
  return postJson<PolymarketOrderPreview>("/api/polymarket/order-preview", payload);
}

export async function previewPolymarketCancel(payload: { orderId: string }) {
  return postJson<PolymarketCancelPreview>("/api/polymarket/cancel-preview", payload);
}

export async function fetchPolymarketAccount(owner?: string): Promise<PolymarketAccountState> {
  const query = owner ? `?owner=${encodeURIComponent(owner)}` : "";
  return getJson<PolymarketAccountState>(`/api/polymarket/account${query}`);
}

export async function fetchMaintenanceStatus(): Promise<MaintenanceStatus> {
  return getJson<MaintenanceStatus>("/api/maintenance/status");
}

export async function runMaintenance(): Promise<MaintenanceRun> {
  return postJson<MaintenanceRun>("/api/maintenance/run", {});
}
