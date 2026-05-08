import {
  aggregateSviStatus,
  hasKillSwitch,
  totalOpenPnl,
  type DashboardData,
  type DataMode,
  type DataSourceStatus,
  type RiskRule,
} from "@vol-arb/core";
import { DeepBookPredictAdapter } from "../deepbook/deepbook-adapter";
import { mockDashboardData } from "../mock/mock-market-data";
import { PolymarketAdapter } from "../polymarket/polymarket-adapter";
import { BtcPriceAdapter } from "../price/price-adapter";

type RealDashboardAdapterOptions = {
  mode?: DataMode;
};

const dryRunRiskRules: RiskRule[] = [
  {
    name: "Dry-run execution",
    condition: "realOrderSubmission == disabled",
    action: "reject_trade",
    severity: "critical",
    active: true,
  },
  {
    name: "Expiry mismatch",
    condition: "abs(deepbookExpiry - externalExpiry) > 24h",
    action: "reject_trade",
    severity: "high",
    active: true,
  },
  {
    name: "External spread width",
    condition: "bidAskSpread > 8%",
    action: "reject_trade",
    severity: "medium",
    active: true,
  },
  {
    name: "BTC source divergence",
    condition: "spotSourceDivergence > 1%",
    action: "pause_opening",
    severity: "high",
    active: false,
  },
  {
    name: "DeepBook feeder lag",
    condition: "lagSeconds > 240",
    action: "pause_opening",
    severity: "high",
    active: false,
  },
];

function degradedStatus(sourceId: string, label: string, detail: string): DataSourceStatus {
  return {
    sourceId,
    label,
    status: "warning",
    mode: "hybrid",
    lastUpdatedAt: Date.now(),
    detail,
  };
}

export class RealDashboardAdapter {
  private readonly mode: DataMode;
  private readonly deepbook: DeepBookPredictAdapter;
  private readonly polymarket: PolymarketAdapter;
  private readonly price: BtcPriceAdapter;

  constructor(options: RealDashboardAdapterOptions = {}) {
    this.mode = options.mode ?? "hybrid";
    this.deepbook = new DeepBookPredictAdapter();
    this.polymarket = new PolymarketAdapter();
    this.price = new BtcPriceAdapter();
  }

  async getDashboardData(): Promise<DashboardData> {
    const [deepbookState, polymarketState, priceState] = await Promise.all([
      this.deepbook.getMarketState(),
      this.polymarket.fetchBtcMarkets(),
      this.price.fetchSpot(),
    ]);

    const sourceStatuses = [deepbookState.status, polymarketState.status, priceState.status];
    const realOracles = deepbookState.oracles;
    const hasRealDeepBook = realOracles.length > 0;
    const hasRealPolymarket = polymarketState.markets.length > 0;
    const hasRealPrice = priceState.spot > 0;
    const effectiveMode: DataMode =
      this.mode === "real" && hasRealDeepBook && hasRealPolymarket && hasRealPrice ? "real" : hasRealDeepBook || hasRealPolymarket || hasRealPrice ? "hybrid" : "mock";

    const surfaces = hasRealDeepBook
      ? this.deepbook.buildSurfaces(realOracles)
      : mockDashboardData.surfaces;
    const sviHealth = hasRealDeepBook
      ? this.deepbook.buildHealthReports(realOracles)
      : mockDashboardData.sviHealth;
    const btcSpot = hasRealPrice ? priceState.spot : hasRealDeepBook ? realOracles[0].spot : mockDashboardData.overview.btcSpot;
    const opportunities = hasRealPolymarket
      ? this.polymarket.buildOpportunities(polymarketState.markets, realOracles[0], btcSpot)
      : mockDashboardData.opportunities;
    const riskRules = dryRunRiskRules.map((rule) => {
      if (rule.name === "BTC source divergence") return { ...rule, active: priceState.status.status !== "healthy" };
      if (rule.name === "DeepBook feeder lag") return { ...rule, active: aggregateSviStatus(sviHealth) !== "healthy" };
      return rule;
    });
    const paperTrades = mockDashboardData.paperTrades.map((trade) => ({
      ...trade,
      hedgePlan: trade.hedgePlan.replace("Mock", "dry-run only"),
    }));

    const tradeCounts = {
      trade: opportunities.filter((opportunity) => opportunity.decision === "trade").length,
      watch: opportunities.filter((opportunity) => opportunity.decision === "watch").length,
      reject: opportunities.filter((opportunity) => opportunity.decision === "reject").length,
    };
    const activeRiskControls = riskRules.some((rule) => rule.active);

    return {
      overview: {
        btcSpot,
        systemStatus: sourceStatuses.some((status) => status.status === "critical")
          ? "critical"
          : sourceStatuses.some((status) => status.status === "warning") || activeRiskControls
            ? "warning"
            : "healthy",
        deepbookSviStatus: aggregateSviStatus(sviHealth),
        activeVenues: [hasRealDeepBook, hasRealPolymarket].filter(Boolean).length,
        validExpiries: surfaces.length,
        maxExecutableEdge: opportunities.length > 0 ? Math.max(...opportunities.map((opportunity) => opportunity.finalExecutableEdge)) : 0,
        killSwitchActive: hasKillSwitch(riskRules) || activeRiskControls,
        openPaperPnl: totalOpenPnl(paperTrades),
        opportunities: tradeCounts,
      },
      surfaces,
      opportunities,
      sviHealth,
      paperTrades,
      riskRules,
      sourceStatuses: [
        ...sourceStatuses,
        ...(hasRealDeepBook ? [] : [degradedStatus("deepbook-fallback", "DeepBook Fallback", "Using mock SVI surface because real OracleSVI data was unavailable.")]),
        ...(hasRealPolymarket ? [] : [degradedStatus("polymarket-fallback", "Polymarket Fallback", "Using mock external opportunities because Polymarket data was unavailable.")]),
      ],
      alerts: [],
      persistence: {
        enabled: false,
        status: "warning",
        detail: "Postgres persistence status is attached by apps/api.",
        lastWriteAt: null,
      },
      mode: effectiveMode,
    };
  }
}
