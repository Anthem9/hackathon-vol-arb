import { getDashboardData } from "./dashboard-service";
import { persistPaperTradeEvent } from "../db/postgres";

export async function getPaperTrades() {
  const data = await getDashboardData();
  return data.paperTrades;
}

export async function createPaperTrade(body: unknown) {
  const data = await getDashboardData();
  const request = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const opportunityId = typeof request.opportunityId === "string" ? request.opportunityId : "manual-paper-trade";
  const sizeUsd = typeof request.sizeUsd === "number" ? request.sizeUsd : 1000;
  const opportunity = data.opportunities.find((item) => item.opportunityId === opportunityId);

  const response = {
    tradeId: `paper-new-${opportunityId}`,
    opportunityId,
    status: "open",
    requestedSizeUsd: sizeUsd,
    simulatedFill: opportunity ? Number((sizeUsd * (1 - opportunity.finalExecutableEdge)).toFixed(2)) : sizeUsd,
    message: `Paper trade accepted in ${data.mode} mode. No real order was submitted.`,
  };
  await persistPaperTradeEvent(response);
  return response;
}
