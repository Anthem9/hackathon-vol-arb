import type { PaperTrade } from "./types";

export function totalOpenPnl(trades: PaperTrade[]): number {
  return trades.filter((trade) => trade.status === "open").reduce((sum, trade) => sum + trade.currentPnl, 0);
}
