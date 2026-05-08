import type { Decision, ExecutableEdge } from "./types";

export function decideOpportunity(edge: ExecutableEdge): Decision {
  if (edge.finalExecutableEdge <= 0) return "reject";
  if (edge.confidenceScore < 0.7) return "reject";
  if (edge.riskScore > 0.6) return "reject";
  if (edge.tradabilityScore < 0.7) return "watch";
  if (edge.finalExecutableEdge > 0.03) return "trade";
  return "watch";
}

export function scoreExecutableEdge(input: Omit<ExecutableEdge, "decision" | "rejectReasons">): ExecutableEdge {
  const draft: ExecutableEdge = {
    ...input,
    decision: "watch",
    rejectReasons: [],
  };
  const rejectReasons: string[] = [];
  if (draft.bidAskAdjustedSpread <= 0) rejectReasons.push("DeepBook fair value sits inside external bid/ask");
  if (draft.confidenceScore < 0.7) rejectReasons.push("Confidence score below minimum threshold");
  if (draft.riskScore > 0.6) rejectReasons.push("Risk score above limit");
  if (draft.tradabilityScore < 0.7) rejectReasons.push("Tradability score below execution threshold");
  if (draft.finalExecutableEdge <= 0) rejectReasons.push("Costs exceed raw volatility spread");
  return {
    ...draft,
    decision: decideOpportunity(draft),
    rejectReasons,
  };
}
