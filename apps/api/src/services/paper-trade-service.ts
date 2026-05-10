import { getDashboardData } from "./dashboard-service";
import { persistPaperTradeEvent, readRecentPaperTrades } from "../db/postgres";
import type { ExecutableEdge, PaperTrade } from "@vol-arb/core";

const fallbackPaperTrades: PaperTrade[] = [];

export async function getPaperTrades() {
  const data = await getDashboardData();
  let persisted: PaperTrade[] = [];
  try {
    persisted = await readRecentPaperTrades(25);
  } catch {
    persisted = [];
  }
  const knownTradeIds = new Set([...fallbackPaperTrades, ...persisted].map((trade) => trade.tradeId));
  return [
    ...fallbackPaperTrades,
    ...persisted.filter((trade) => !fallbackPaperTrades.some((fallback) => fallback.tradeId === trade.tradeId)),
    ...data.paperTrades.filter((trade) => !knownTradeIds.has(trade.tradeId)),
  ];
}

export async function createPaperTrade(body: unknown) {
  const data = await getDashboardData();
  const request = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const opportunityId = typeof request.opportunityId === "string" ? request.opportunityId : "manual-paper-trade";
  const sizeUsd = typeof request.sizeUsd === "number" ? request.sizeUsd : 1000;
  const opportunity = data.opportunities.find((item) => item.opportunityId === opportunityId);

  const response: PaperTrade = buildPaperTrade({
    opportunity,
    opportunityId,
    sizeUsd,
    mode: data.mode,
  });
  await persistPaperTradeEvent(response as unknown as Record<string, unknown>);
  fallbackPaperTrades.unshift(response);
  fallbackPaperTrades.splice(25);
  return {
    ...response,
    message: `Paper trade accepted in ${data.mode} mode. No real order was submitted.`,
  };
}

function buildPaperTrade({
  opportunity,
  opportunityId,
  sizeUsd,
  mode,
}: {
  opportunity?: ExecutableEdge;
  opportunityId: string;
  sizeUsd: number;
  mode: string;
}): PaperTrade {
  const edge = opportunity?.finalExecutableEdge ?? 0;
  const risk = opportunity?.riskScore ?? 0.5;
  const slippage = -Math.max(2, sizeUsd * 0.0015);
  const fees = -Math.max(1.5, sizeUsd * 0.001);
  const volEdgePnl = Number((sizeUsd * Math.max(edge, 0)).toFixed(2));
  const deltaPnl = Number((-sizeUsd * risk * 0.004).toFixed(2));
  const hedgePnl = opportunity?.hedgeVenue ? Number((-sizeUsd * 0.002).toFixed(2)) : 0;
  const totalPnl = Number((volEdgePnl + deltaPnl + hedgePnl + fees + slippage).toFixed(2));

  return {
    tradeId: `paper-${Date.now()}-${opportunityId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    opportunityId,
    status: "open",
    signalTime: Date.now(),
    entryPrice: Number(Math.max(0.01, Math.min(0.99, 0.5 - edge)).toFixed(4)),
    simulatedFill: Number(Math.max(0.01, Math.min(0.99, 0.5 - edge + Math.abs(slippage) / sizeUsd)).toFixed(4)),
    hedgePlan: opportunity?.hedgeVenue
      ? `Hedge ${opportunity.underlying} residual delta on ${opportunity.hedgeVenue}; paper notional ${sizeUsd.toFixed(0)} ${mode}.`
      : `No hedge venue selected; paper notional ${sizeUsd.toFixed(0)} ${mode}.`,
    currentPnl: totalPnl,
    attribution: {
      totalPnl,
      volEdgePnl,
      deltaPnl,
      hedgePnl,
      fundingPnl: 0,
      fees,
      slippage,
      executionMismatch: Number((-Math.abs(edge) * sizeUsd * 0.05).toFixed(2)),
      residualRiskPnl: Number((-risk * sizeUsd * 0.001).toFixed(2)),
    },
  };
}
