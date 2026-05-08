export type PayoffType =
  | "binary"
  | "call"
  | "put"
  | "range"
  | "spread"
  | "structured";

export type Decision = "trade" | "watch" | "reject";
export type HealthStatus = "healthy" | "warning" | "stale" | "critical";

export type NormalizedInstrument = {
  instrumentId: string;
  venue: string;
  underlying: string;
  expiry: number;
  strike?: number;
  lowerStrike?: number;
  upperStrike?: number;
  payoffType: PayoffType;
  direction?: "above" | "below" | "between" | "outside";
  quoteCurrency: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  bidSize?: number;
  askSize?: number;
  liquidityScore: number;
  settlementSource: string;
  settlementRule: string;
  timestamp: number;
  confidenceScore: number;
};

export type SviParams = {
  a: number;
  b: number;
  rho: number;
  m: number;
  sigma: number;
};

export type SurfacePoint = {
  strike: number;
  deepbookIv: number;
  externalBidIv: number;
  externalMidIv: number;
  externalAskIv: number;
  deepbookFairBinary: number;
  externalBid: number;
  externalMid: number;
  externalAsk: number;
};

export type VolSurface = {
  venue: string;
  underlying: string;
  expiry: number;
  label: string;
  points: SurfacePoint[];
  surfaceQualityScore: number;
  staleScore: number;
  lastUpdatedAt: number;
};

export type ExecutableEdge = {
  opportunityId: string;
  sourceVenue: string;
  targetVenue: string;
  hedgeVenue?: string;
  underlying: string;
  expiry: number;
  strike?: number;
  rawVolSpread: number;
  bidAskAdjustedSpread: number;
  feeAdjustedSpread: number;
  hedgeAdjustedSpread: number;
  latencyAdjustedSpread: number;
  finalExecutableEdge: number;
  recommendedSizeUsd: number;
  maxSizeUsd: number;
  confidenceScore: number;
  riskScore: number;
  tradabilityScore: number;
  decision: Decision;
  rejectReasons?: string[];
  timestamp: number;
};

export type Overview = {
  btcSpot: number;
  systemStatus: HealthStatus;
  deepbookSviStatus: HealthStatus;
  activeVenues: number;
  validExpiries: number;
  maxExecutableEdge: number;
  killSwitchActive: boolean;
  openPaperPnl: number;
  opportunities: {
    trade: number;
    watch: number;
    reject: number;
  };
};

export type SviHealthReport = {
  oracleId: string;
  underlying: string;
  expiry: number;
  label: string;
  lastUpdatedAt: number;
  lagSeconds: number;
  staleScore: number;
  surfaceJumpScore: number;
  externalDeviationScore: number;
  abnormalPoints: number;
  status: HealthStatus;
  reasons: string[];
};

export type PnlAttribution = {
  totalPnl: number;
  volEdgePnl: number;
  deltaPnl: number;
  hedgePnl: number;
  fundingPnl: number;
  fees: number;
  slippage: number;
  executionMismatch: number;
  residualRiskPnl: number;
};

export type PaperTrade = {
  tradeId: string;
  opportunityId: string;
  signalTime: number;
  status: "open" | "closed";
  entryPrice: number;
  simulatedFill: number;
  hedgePlan: string;
  currentPnl: number;
  attribution: PnlAttribution;
  exitReason?: string;
};

export type RiskRule = {
  name: string;
  condition: string;
  action: "pause_opening" | "reduce_only" | "full_stop" | "reject_trade";
  severity: "low" | "medium" | "high" | "critical";
  active: boolean;
};

export type DataMode = "mock" | "real" | "hybrid";

export type DataSourceStatus = {
  sourceId: string;
  label: string;
  status: HealthStatus;
  mode: DataMode;
  lastUpdatedAt: number | null;
  latencyMs?: number;
  detail: string;
  error?: string;
};

export type PersistenceStatus = {
  enabled: boolean;
  status: HealthStatus;
  detail: string;
  lastWriteAt: number | null;
};

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertEvent = {
  alertId: string;
  ruleId: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  status: "active" | "resolved";
  sourceId: string;
  createdAt: number;
  resolvedAt?: number;
  metadata?: Record<string, unknown>;
};

export type DashboardData = {
  overview: Overview;
  surfaces: VolSurface[];
  opportunities: ExecutableEdge[];
  sviHealth: SviHealthReport[];
  paperTrades: PaperTrade[];
  riskRules: RiskRule[];
  sourceStatuses: DataSourceStatus[];
  alerts: AlertEvent[];
  persistence: PersistenceStatus;
  mode: DataMode;
};
