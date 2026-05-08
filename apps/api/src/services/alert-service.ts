import type { AlertEvent, DashboardData, DataSourceStatus, ExecutableEdge, RiskRule, SviHealthReport } from "@vol-arb/core";
import { readRecentAlerts } from "../db/postgres";

function now() {
  return Date.now();
}

function stableId(parts: Array<string | number | undefined>) {
  return parts.filter((part) => part !== undefined && part !== "").join(":").toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
}

function alert(
  ruleId: string,
  title: string,
  message: string,
  severity: AlertEvent["severity"],
  sourceId: string,
  metadata: Record<string, unknown> = {},
): AlertEvent {
  return {
    alertId: stableId([ruleId, sourceId, metadata.opportunityId as string | undefined, metadata.oracleId as string | undefined]),
    ruleId,
    title,
    message,
    severity,
    status: "active",
    sourceId,
    createdAt: now(),
    metadata,
  };
}

export function buildAlerts(data: Omit<DashboardData, "alerts" | "persistence">): AlertEvent[] {
  const alerts: AlertEvent[] = [
    ...sourceAlerts(data.sourceStatuses),
    ...riskAlerts(data.riskRules),
    ...sviAlerts(data.sviHealth),
    ...opportunityAlerts(data.opportunities),
  ];
  return dedupeAlerts(alerts).sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

export async function getAlerts(limit = 50) {
  try {
    const persisted = await readRecentAlerts(limit);
    if (persisted.length > 0) return persisted;
  } catch {
    return [];
  }
  return [];
}

function sourceAlerts(sources: DataSourceStatus[]) {
  return sources.flatMap((source) => {
    if (source.status === "healthy") return [];
    return [
      alert(
        `source-${source.status}`,
        `${source.label} ${source.status}`,
        source.error ? `${source.detail}: ${source.error}` : source.detail,
        source.status === "critical" ? "critical" : "warning",
        source.sourceId,
        { mode: source.mode, latencyMs: source.latencyMs },
      ),
    ];
  });
}

function riskAlerts(rules: RiskRule[]) {
  return rules
    .filter((rule) => rule.active)
    .map((rule) =>
      alert(
        `risk-${rule.name}`,
        rule.name,
        `${rule.condition} -> ${rule.action}`,
        rule.severity === "critical" ? "critical" : "warning",
        "risk-control",
        { action: rule.action, severity: rule.severity },
      ),
    );
}

function sviAlerts(reports: SviHealthReport[]) {
  return reports.flatMap((report) => {
    if (report.status === "healthy") return [];
    return [
      alert(
        `svi-${report.status}`,
        `${report.label} OracleSVI ${report.status}`,
        report.reasons.join("; "),
        report.status === "critical" || report.status === "stale" ? "critical" : "warning",
        "deepbook-predict",
        {
          oracleId: report.oracleId,
          lagSeconds: report.lagSeconds,
          staleScore: report.staleScore,
          abnormalPoints: report.abnormalPoints,
        },
      ),
    ];
  });
}

function opportunityAlerts(opportunities: ExecutableEdge[]) {
  return opportunities.flatMap((opportunity) => {
    if (opportunity.finalExecutableEdge < 0.03) return [];
    return [
      alert(
        "opportunity-edge-threshold",
        `${opportunity.underlying} edge threshold crossed`,
        `${opportunity.sourceVenue} -> ${opportunity.targetVenue} edge ${(opportunity.finalExecutableEdge * 100).toFixed(2)}%, decision ${opportunity.decision}.`,
        opportunity.decision === "trade" ? "critical" : "warning",
        "opportunity-engine",
        {
          opportunityId: opportunity.opportunityId,
          decision: opportunity.decision,
          finalExecutableEdge: opportunity.finalExecutableEdge,
          riskScore: opportunity.riskScore,
        },
      ),
    ];
  });
}

function dedupeAlerts(alerts: AlertEvent[]) {
  return Array.from(new Map(alerts.map((item) => [item.alertId, item])).values());
}

function severityRank(severity: AlertEvent["severity"]) {
  return severity === "critical" ? 3 : severity === "warning" ? 2 : 1;
}
