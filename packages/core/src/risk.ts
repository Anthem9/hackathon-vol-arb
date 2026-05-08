import type { HealthStatus, RiskRule, SviHealthReport } from "./types";

export function statusRank(status: HealthStatus): number {
  return { healthy: 0, warning: 1, stale: 2, critical: 3 }[status];
}

export function aggregateSviStatus(reports: SviHealthReport[]): HealthStatus {
  return reports.reduce<HealthStatus>(
    (worst, report) => (statusRank(report.status) > statusRank(worst) ? report.status : worst),
    "healthy",
  );
}

export function hasKillSwitch(rules: RiskRule[]): boolean {
  return rules.some((rule) => rule.active && rule.action === "full_stop");
}
