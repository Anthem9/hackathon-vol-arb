import { createPaperTrade, getPaperTrades } from "../services/paper-trade-service";

export async function paperTradesRoute(method: string, body?: unknown) {
  if (method === "POST") {
    return createPaperTrade(body);
  }
  return getPaperTrades();
}
