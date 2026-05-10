"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  BellRing,
  AlertTriangle,
  CircleDollarSign,
  DatabaseZap,
  Gauge,
  HeartPulse,
  Radar,
  ShieldCheck,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardApiData, DeepBookTestnetReadiness, MaintenanceStatus, PolymarketAccountState, PolymarketCancelPreview, PolymarketOrderPreview, PolymarketTradingReadiness } from "../../lib/api-client";
import type { HealthStatus } from "@vol-arb/core";
import { backfillDeepBookTransactions, fetchDashboardData, fetchDeepBookPositions, fetchDeepBookReadiness, fetchMaintenanceStatus, fetchPolymarketAccount, fetchPolymarketTradingReadiness, postAlertAction, previewPolymarketCancel, previewPolymarketOrder, reconcileDeepBookTransactions, runMaintenance, type DeepBookPositionState } from "../../lib/api-client";
import { StatusPill } from "../ui/status-pill";

const WalletTradePanel = dynamic(
  () => import("../wallet/wallet-trade-panel").then((mod) => mod.WalletTradePanel),
  {
    ssr: false,
    loading: () => (
      <section className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5 text-sm text-terminal-muted">
        Loading wallet controls...
      </section>
    ),
  },
);

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

function formatExpiry(value: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatTime(value: number | null) {
  if (!value) return "never";
  return new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function shortObjectId(value: string | null | undefined) {
  if (!value) return "not set";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function formatScaledPrice(value: number) {
  if (!value) return "0";
  const scaled = value / 1_000_000_000;
  return scaled >= 1000 ? money.format(scaled) : scaled.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatDusdcBaseUnits(value: number | string | null | undefined) {
  const amount = BigInt(value ?? 0);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${fraction ? `${whole}.${fraction}` : whole.toString()} DUSDC`;
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function suiExplorerTxUrl(digest: string) {
  return `https://suivision.xyz/txblock/${encodeURIComponent(digest)}?network=testnet`;
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "cyan",
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: "cyan" | "green" | "amber" | "red" | "violet";
}) {
  const color = {
    cyan: "text-terminal-cyan",
    green: "text-terminal-green",
    amber: "text-terminal-amber",
    red: "text-terminal-red",
    violet: "text-terminal-violet",
  }[tone];

  return (
    <section className="rounded-lg border border-white/10 bg-white/[0.045] p-4 shadow-glow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-terminal-muted">{label}</p>
          <p className={`mt-3 text-2xl font-semibold ${color}`}>{value}</p>
        </div>
        <div className={`rounded-md border border-white/10 bg-white/[0.06] p-2 ${color}`}>{icon}</div>
      </div>
      <p className="mt-3 text-sm text-slate-300">{detail}</p>
    </section>
  );
}

function LoadingState() {
  return (
    <main className="terminal-grid flex min-h-screen items-center justify-center p-6">
      <div className="rounded-lg border border-white/10 bg-terminal-panel p-8 text-center shadow-glow">
        <Activity className="mx-auto h-8 w-8 animate-pulse text-terminal-cyan" />
        <p className="mt-4 text-sm uppercase tracking-[0.25em] text-terminal-muted">Loading vol-arb terminal</p>
      </div>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="terminal-grid flex min-h-screen items-center justify-center p-6">
      <div className="max-w-lg rounded-lg border border-red-400/30 bg-red-950/30 p-8 shadow-glow">
        <AlertTriangle className="h-8 w-8 text-terminal-red" />
        <h1 className="mt-4 text-2xl font-semibold">API connection failed</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{message}</p>
        <p className="mt-4 text-sm text-terminal-muted">Start apps/api on port 4000 or set NEXT_PUBLIC_API_BASE_URL.</p>
      </div>
    </main>
  );
}

function Overview({ data }: { data: DashboardApiData }) {
  return (
    <section id="overview" className="scroll-mt-32 grid gap-4 lg:grid-cols-4">
      <MetricCard
        label="BTC Spot"
        value={money.format(data.overview.btcSpot)}
        detail={data.mode === "mock" ? "Reference price used by mock SVI and binary markets." : "Reference price from live BTC spot sources."}
        icon={<CircleDollarSign className="h-5 w-5" />}
      />
      <MetricCard
        label="Max Executable Edge"
        value={percent.format(data.overview.maxExecutableEdge)}
        detail={`${data.overview.opportunities.trade} trade, ${data.overview.opportunities.watch} watch, ${data.overview.opportunities.reject} reject.`}
        icon={<TrendingUp className="h-5 w-5" />}
        tone="green"
      />
      <MetricCard
        label="DeepBook SVI"
        value={data.overview.deepbookSviStatus.toUpperCase()}
        detail="Aggregated feeder freshness and surface-quality state."
        icon={<HeartPulse className="h-5 w-5" />}
        tone={data.overview.deepbookSviStatus === "healthy" ? "green" : "amber"}
      />
      <MetricCard
        label="Risk Gate"
        value={data.overview.killSwitchActive ? "ACTIVE" : "CLEAR"}
        detail={data.overview.killSwitchActive ? "Opening is blocked until the active kill switch clears." : "No global kill switch is active."}
        icon={<ShieldCheck className="h-5 w-5" />}
        tone={data.overview.killSwitchActive ? "red" : "violet"}
      />
    </section>
  );
}

function SourceStatusPanel({ data }: { data: DashboardApiData }) {
  return (
    <section id="status" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Real Data Status</h2>
          <p className="text-sm text-terminal-muted">Mode {data.mode}; public DeepBook, Sui, Polymarket, and BTC price source health.</p>
        </div>
        <DatabaseZap className="h-5 w-5 text-terminal-cyan" />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {data.sourceStatuses.map((source) => (
          <div key={source.sourceId} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{source.label}</p>
              <StatusPill value={source.status} />
            </div>
            <p className="mt-2 text-xs text-terminal-muted">{source.detail}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.14em] text-slate-300">
              <span>{source.mode}</span>
              {typeof source.latencyMs === "number" ? <span>{source.latencyMs}ms</span> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold">Postgres Persistence</p>
          <StatusPill value={data.persistence.status} />
        </div>
        <p className="mt-2 text-terminal-muted">{data.persistence.detail}</p>
      </div>
    </section>
  );
}

function AlertPanel({ data, onRefresh }: { data: DashboardApiData; onRefresh: () => Promise<void> }) {
  const [pendingAlert, setPendingAlert] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function submitAction(alertId: string, action: "resolve" | "silence") {
    setPendingAlert(`${action}:${alertId}`);
    setActionError(null);
    try {
      await postAlertAction({ alertId, action, reason: "Operator action from dashboard" });
      await onRefresh();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Alert action failed");
    } finally {
      setPendingAlert(null);
    }
  }

  return (
    <section id="alerts" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Alert System</h2>
          <p className="text-sm text-terminal-muted">Source, risk, SVI, and opportunity alerts generated from the current pipeline.</p>
        </div>
        <BellRing className="h-5 w-5 text-terminal-amber" />
      </div>
      {actionError ? <p className="mt-4 text-sm text-terminal-red">{actionError}</p> : null}
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {data.alerts.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-white/[0.035] p-4 text-sm text-terminal-muted">No active alerts.</div>
        ) : (
          data.alerts.slice(0, 6).map((alert) => (
            <div key={alert.alertId} className={`rounded-md border p-4 ${alert.status === "resolved" ? "border-white/10 bg-white/[0.025]" : alert.severity === "critical" ? "border-red-300/30 bg-red-300/10" : "border-amber-300/30 bg-amber-300/10"}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{alert.title}</p>
                <span className="text-xs uppercase tracking-[0.14em] text-slate-300">{alert.status === "resolved" ? "resolved" : alert.severity}</span>
              </div>
              <p className="mt-2 text-xs text-slate-300">{alert.message}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] uppercase tracking-[0.14em] text-terminal-muted">{alert.sourceId}</p>
                <div className="flex gap-2">
                  <button
                    className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-200 hover:border-cyan-300/40 hover:bg-cyan-300/10"
                    disabled={alert.status === "resolved" || pendingAlert !== null}
                    onClick={() => submitAction(alert.alertId, "resolve")}
                  >
                    Resolve
                  </button>
                  <button
                    className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-slate-200 hover:border-amber-300/40 hover:bg-amber-300/10"
                    disabled={alert.status === "resolved" || pendingAlert !== null}
                    onClick={() => submitAction(alert.alertId, "silence")}
                  >
                    Silence
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function SurfaceComparison({ data }: { data: DashboardApiData }) {
  const surface = data.surfaces[1] ?? data.surfaces[0];
  const heatmap = surface.points.map((point) => ({
    strike: point.strike,
    spread: point.externalMidIv - point.deepbookIv,
  }));

  return (
    <section id="surface" className="scroll-mt-32 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
      <div className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Vol Surface Comparison</h2>
            <p className="text-sm text-terminal-muted">
              DeepBook SVI vs external bid / mid / ask for {surface.label} expiry.
            </p>
          </div>
          <span className="text-xs text-terminal-muted">{formatExpiry(surface.expiry)}</span>
        </div>
        <div className="mt-6 h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={surface.points}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="strike" stroke="#7e8da3" tickFormatter={(value) => `${Number(value) / 1000}k`} />
              <YAxis stroke="#7e8da3" tickFormatter={(value) => percent.format(Number(value))} />
              <Tooltip
                contentStyle={{ background: "#0e141b", border: "1px solid #26313e", borderRadius: 8 }}
                formatter={(value: number) => percent.format(value)}
              />
              <Line isAnimationActive={false} type="monotone" dataKey="deepbookIv" stroke="#2ce6d1" strokeWidth={3} dot={false} name="DeepBook SVI" />
              <Line isAnimationActive={false} type="monotone" dataKey="externalBidIv" stroke="#5df58d" strokeWidth={2} dot={false} name="External Bid" />
              <Line isAnimationActive={false} type="monotone" dataKey="externalMidIv" stroke="#ffca58" strokeWidth={2} dot={false} name="External Mid" />
              <Line isAnimationActive={false} type="monotone" dataKey="externalAskIv" stroke="#ff5d73" strokeWidth={2} dot={false} name="External Ask" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
        <h2 className="text-lg font-semibold">Spread Heatmap</h2>
        <p className="text-sm text-terminal-muted">External mid IV minus DeepBook SVI.</p>
        <div className="mt-6 grid gap-2">
          {heatmap.map((row) => (
            <div key={row.strike} className="grid grid-cols-[72px_1fr_64px] items-center gap-3 text-sm">
              <span className="text-terminal-muted">{row.strike / 1000}k</span>
              <div className="h-3 overflow-hidden rounded bg-white/5">
                <div
                  className={`h-full rounded ${row.spread > 0.05 ? "bg-terminal-green" : row.spread > 0 ? "bg-terminal-cyan" : "bg-terminal-red"}`}
                  style={{ width: `${Math.min(100, Math.abs(row.spread) * 800)}%` }}
                />
              </div>
              <span className="text-right">{percent.format(row.spread)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OpportunityTable({ data }: { data: DashboardApiData }) {
  return (
    <section id="opportunities" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Opportunity Table</h2>
          <p className="text-sm text-terminal-muted">Bid/ask-aware edge, explicit reject reasons, no midpoint-only arbitrage.</p>
        </div>
        <Zap className="h-5 w-5 text-terminal-cyan" />
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.16em] text-terminal-muted">
              <th className="py-3 pr-4">Decision</th>
              <th className="py-3 pr-4">Pair</th>
              <th className="py-3 pr-4">Expiry</th>
              <th className="py-3 pr-4">Strike</th>
              <th className="py-3 pr-4">Raw Spread</th>
              <th className="py-3 pr-4">Executable Edge</th>
              <th className="py-3 pr-4">Size</th>
              <th className="py-3 pr-4">Risk</th>
              <th className="py-3 pr-4">Reason</th>
            </tr>
          </thead>
          <tbody>
            {data.opportunities.map((opportunity) => (
              <tr key={opportunity.opportunityId} className="border-b border-white/[0.06] align-top">
                <td className="py-4 pr-4"><StatusPill value={opportunity.decision} /></td>
                <td className="py-4 pr-4 text-slate-200">
                  {opportunity.sourceVenue} {"->"} {opportunity.targetVenue}
                </td>
                <td className="py-4 pr-4">{formatExpiry(opportunity.expiry)}</td>
                <td className="py-4 pr-4">{money.format(opportunity.strike ?? 0)}</td>
                <td className="py-4 pr-4 text-terminal-cyan">{percent.format(opportunity.rawVolSpread)}</td>
                <td className="py-4 pr-4 text-terminal-green">{percent.format(opportunity.finalExecutableEdge)}</td>
                <td className="py-4 pr-4">{money.format(opportunity.recommendedSizeUsd)}</td>
                <td className="py-4 pr-4">{percent.format(opportunity.riskScore)}</td>
                <td className="max-w-[320px] py-4 pr-4 text-slate-300">
                  {opportunity.rejectReasons && opportunity.rejectReasons.length > 0
                    ? opportunity.rejectReasons.join("; ")
                    : "Clears cost, confidence, risk, and tradability filters."}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SviHealth({ data }: { data: DashboardApiData }) {
  return (
    <section id="svi-health" className="scroll-mt-32 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
        <h2 className="text-lg font-semibold">SVI Feeder Health</h2>
        <p className="text-sm text-terminal-muted">Freshness, jump score, external deviation, and abnormal points.</p>
        <div className="mt-5 grid gap-3">
          {data.sviHealth.map((report) => (
            <div key={report.oracleId} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{report.label} OracleSVI</p>
                  <p className="text-xs text-terminal-muted">Lag {report.lagSeconds}s · abnormal {report.abnormalPoints}</p>
                </div>
                <StatusPill value={report.status} />
              </div>
              <p className="mt-3 text-sm text-slate-300">{report.reasons.join("; ")}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
        <div className="flex items-center gap-2">
          <Radar className="h-5 w-5 text-terminal-violet" />
          <h2 className="text-lg font-semibold">Oracle Risk Timeline</h2>
        </div>
        <div className="mt-6 h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.sviHealth}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="label" stroke="#7e8da3" />
              <YAxis stroke="#7e8da3" tickFormatter={(value) => percent.format(Number(value))} />
              <Tooltip contentStyle={{ background: "#0e141b", border: "1px solid #26313e", borderRadius: 8 }} />
              <Area isAnimationActive={false} type="monotone" dataKey="staleScore" stackId="1" stroke="#ffca58" fill="#ffca58" fillOpacity={0.22} name="Stale Score" />
              <Area isAnimationActive={false} type="monotone" dataKey="externalDeviationScore" stackId="1" stroke="#9f7cff" fill="#9f7cff" fillOpacity={0.18} name="External Deviation" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

function PreTradeAudit({ data }: { data: DashboardApiData }) {
  const bestOpportunity = data.opportunities.find((opportunity) => opportunity.decision === "trade") ?? data.opportunities[0];
  const criticalAlerts = data.alerts.filter((alert) => alert.status === "active" && alert.severity === "critical");
  const activeRiskRules = data.riskRules.filter((rule) => rule.active);
  const primaryOracle = data.sviHealth[0];
  const auditRows: Array<{ label: string; status: HealthStatus; detail: string }> = [
    {
      label: "Persistence",
      status: data.persistence.status,
      detail: data.persistence.detail,
    },
    {
      label: "Oracle Freshness",
      status: primaryOracle?.status ?? "warning",
      detail: primaryOracle ? `${primaryOracle.label} lag ${primaryOracle.lagSeconds}s; ${primaryOracle.reasons.join("; ")}` : "No oracle health report.",
    },
    {
      label: "Signal",
      status: bestOpportunity?.decision === "trade" ? "healthy" : bestOpportunity?.decision === "watch" ? "warning" : "critical",
      detail: bestOpportunity
        ? `${bestOpportunity.opportunityId}: ${bestOpportunity.decision}, edge ${percent.format(bestOpportunity.finalExecutableEdge)}, size ${money.format(bestOpportunity.recommendedSizeUsd)}.`
        : "No opportunity available.",
    },
    {
      label: "Risk Gate",
      status: criticalAlerts.length > 0 || data.overview.killSwitchActive ? "critical" : activeRiskRules.length > 0 ? "warning" : "healthy",
      detail:
        criticalAlerts.length > 0
          ? `${criticalAlerts.length} active critical alert(s).`
          : activeRiskRules.length > 0
            ? `${activeRiskRules.length} active rule(s); opening may be restricted.`
            : "No active blocking risk rule.",
    },
  ];
  const blockers = auditRows.filter((row) => row.status === "critical").map((row) => row.label);

  return (
    <section id="audit" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pre-Trade Audit</h2>
          <p className="text-sm text-terminal-muted">Readiness gates before moving from dry-run to wallet execution.</p>
        </div>
        <ShieldCheck className={blockers.length === 0 ? "h-5 w-5 text-terminal-green" : "h-5 w-5 text-terminal-amber"} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {auditRows.map((row) => (
          <div key={row.label} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{row.label}</p>
              <StatusPill value={row.status} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-300">{row.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-md border border-white/10 bg-white/[0.035] p-4 text-sm">
        <p className="font-semibold">{blockers.length === 0 ? "Dry-run path is clear" : "Blocked before real execution"}</p>
        <p className="mt-2 text-terminal-muted">
          {blockers.length === 0
            ? "Wallet-specific checks still run in the wallet panel before any transaction is built."
            : blockers.join(", ")}
        </p>
      </div>
    </section>
  );
}

function TestnetReadiness() {
  const [readiness, setReadiness] = useState<DeepBookTestnetReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDeepBookReadiness();
      setReadiness(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load testnet readiness.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const primaryOracle = readiness?.oracleCandidates[0];
  const checks = [
    {
      label: "SUI Gas",
      ready: Boolean(readiness && readiness.balances.sui >= 0.05),
      detail: readiness ? `${readiness.balances.sui.toFixed(4)} SUI available on the generated testnet address.` : "Checking generated address.",
    },
    {
      label: "Manager",
      ready: Boolean(readiness?.manager.found && readiness.manager.ownerMatchesConfiguredAddress),
      detail: readiness?.manager.found
        ? `${shortObjectId(readiness.managerId)} owner ${readiness.manager.ownerMatchesConfiguredAddress ? "matches" : "does not match"} configured address.`
        : "No usable PredictManager found yet.",
    },
    {
      label: "DUSDC",
      ready: Boolean(readiness && readiness.balances.walletQuote > 0),
      detail: readiness
        ? `Wallet ${readiness.balances.walletQuote.toFixed(2)} DUSDC, manager ${readiness.balances.managerQuote.toFixed(2)} DUSDC.`
        : "Checking quote asset balance.",
    },
    {
      label: "BTC Oracle",
      ready: Boolean(primaryOracle),
      detail: primaryOracle
        ? `${shortObjectId(primaryOracle.oracleId)} expires ${formatTime(primaryOracle.expiry)}; min strike ${formatScaledPrice(primaryOracle.minStrike)}, tick ${formatScaledPrice(primaryOracle.tickSize)}.`
        : "Discovering active BTC OracleSVI candidates.",
    },
  ];

  return (
    <section id="testnet-readiness" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Testnet Readiness</h2>
          <p className="text-sm text-terminal-muted">Server-side checks for the generated Sui address before real DUSDC deposit and mint tests.</p>
        </div>
        <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error ? <p className="mt-4 rounded border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {checks.map((check) => (
          <div key={check.label} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{check.label}</p>
              <StatusPill value={check.ready ? "healthy" : "warning"} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-300">{check.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-white/10 bg-black/20 p-4 text-sm">
          <p className="font-semibold">Next Action</p>
          <p className="mt-2 text-terminal-muted">
            {readiness ? readiness.readiness.nextAction.replaceAll("_", " ") : "loading"}
          </p>
          <p className="mt-3 text-xs text-terminal-muted">
            Deposit dry-run: {readiness?.readiness.canDepositDryRun ? "ready" : "blocked"} · Mint dry-run:{" "}
            {readiness?.readiness.canMintDryRun ? "ready" : "blocked"}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 p-4 text-sm">
          <p className="font-semibold">Blocked Reasons</p>
          <p className="mt-2 text-terminal-muted">
            {readiness && readiness.readiness.blockers.length > 0 ? readiness.readiness.blockers.join("; ") : "No server-side blockers."}
          </p>
          {readiness && readiness.readiness.warnings.length > 0 ? (
            <p className="mt-2 text-xs text-terminal-amber">{readiness.readiness.warnings.join("; ")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PolymarketReadiness() {
  const [readiness, setReadiness] = useState<PolymarketTradingReadiness | null>(null);
  const [accountState, setAccountState] = useState<PolymarketAccountState | null>(null);
  const [preview, setPreview] = useState<PolymarketOrderPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState("");
  const [tokenId, setTokenId] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("0.50");
  const [size, setSize] = useState("1");
  const [cancelOrderId, setCancelOrderId] = useState("");
  const [cancelPreview, setCancelPreview] = useState<PolymarketCancelPreview | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [next, account] = await Promise.all([fetchPolymarketTradingReadiness(), fetchPolymarketAccount()]);
      setReadiness(next);
      setAccountState(account);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Polymarket trading readiness.");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function buildPreview() {
    try {
      setPreview(await previewPolymarketOrder({ market, tokenId, side, price, size }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to preview Polymarket order.");
    }
  }

  async function buildCancelPreview() {
    try {
      setCancelPreview(await previewPolymarketCancel({ orderId: cancelOrderId }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to preview Polymarket cancel.");
    }
  }

  const checks = readiness?.checks ?? [];

  return (
    <section id="polymarket-readiness" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Polymarket Trading Readiness</h2>
          <p className="text-sm text-terminal-muted">Authenticated CLOB prerequisites; order submission remains behind explicit live-trading and manual confirmation gates.</p>
        </div>
        <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={refresh}>
          Refresh
        </button>
      </div>
      {error ? <p className="mt-4 rounded border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {checks.map((check) => (
          <div key={check.label} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">{check.label}</p>
              <StatusPill value={check.ready ? "healthy" : "warning"} />
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-300">{check.detail}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-md border border-white/10 bg-black/20 p-4 text-sm">
          <p className="font-semibold">Order Gate</p>
          <p className={`mt-2 font-semibold ${readiness?.orderSubmissionReady ? "text-terminal-green" : "text-terminal-amber"}`}>
            {readiness?.orderSubmissionReady ? "MANUAL CONFIRM REQUIRED" : "READ ONLY"}
          </p>
          <p className="mt-2 text-xs text-terminal-muted">
            L2 auth {readiness?.capabilities.authenticatedRequests ? "ready" : "blocked"} · Signing {readiness?.capabilities.localOrderSigning ? "ready" : "blocked"}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-black/20 p-4 text-sm">
          <p className="font-semibold">Blocked Reasons</p>
          <p className="mt-2 text-terminal-muted">
            {readiness && readiness.blockers.length > 0 ? readiness.blockers.join("; ") : "No Polymarket trading blockers."}
          </p>
        </div>
      </div>
      <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Account Positions</p>
            <p className="mt-1 text-xs text-terminal-muted">Public Data API positions for the configured Polymarket wallet. Open orders and cancel remain backend-only L2-gated.</p>
          </div>
          <p className="text-xs text-terminal-muted">{accountState?.walletAddress ? `${accountState.walletAddress.slice(0, 6)}...${accountState.walletAddress.slice(-4)}` : "wallet not configured"}</p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricCard label="Position Value" value={`$${(accountState?.totals.currentValue ?? 0).toFixed(2)}`} detail={`${accountState?.positions.length ?? 0} active position(s).`} icon={<CircleDollarSign className="h-5 w-5" />} tone="cyan" />
          <MetricCard label="Cash PnL" value={`$${(accountState?.totals.cashPnl ?? 0).toFixed(2)}`} detail={`Realized $${(accountState?.totals.realizedPnl ?? 0).toFixed(2)}`} icon={<TrendingUp className="h-5 w-5" />} tone={(accountState?.totals.cashPnl ?? 0) >= 0 ? "green" : "red"} />
          <MetricCard label="Open Orders" value={accountState?.openOrders.enabled ? `${accountState.orders.length}` : accountState?.openOrders.ready ? "L2 READY" : "BLOCKED"} detail={accountState?.openOrders.detail ?? "Loading open-order gate."} icon={<Radar className="h-5 w-5" />} tone={accountState?.openOrders.enabled ? "green" : accountState?.openOrders.ready ? "cyan" : "amber"} />
          <MetricCard label="Cancel Orders" value={accountState?.cancelOrders.ready ? "READY" : "DISABLED"} detail={accountState?.cancelOrders.detail ?? "Loading cancel gate."} icon={<ShieldCheck className="h-5 w-5" />} tone={accountState?.cancelOrders.ready ? "green" : "amber"} />
        </div>
        {accountState?.positions.length ? (
          <div className="mt-4 max-h-52 overflow-auto rounded border border-white/10">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-terminal-muted">
                <tr>
                  <th className="px-3 py-2">Market</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">PnL</th>
                </tr>
              </thead>
              <tbody>
                {accountState.positions.slice(0, 6).map((position) => (
                  <tr key={`${position.conditionId}:${position.asset}`} className="border-t border-white/10">
                    <td className="px-3 py-2 text-slate-200">{position.title || position.slug || position.conditionId.slice(0, 10)}</td>
                    <td className="px-3 py-2">{position.outcome}</td>
                    <td className="px-3 py-2">{position.size.toFixed(3)}</td>
                    <td className="px-3 py-2">${position.currentValue.toFixed(2)}</td>
                    <td className={`px-3 py-2 ${position.cashPnl >= 0 ? "text-terminal-green" : "text-terminal-red"}`}>${position.cashPnl.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-xs text-terminal-muted">{accountState?.blockers.length ? accountState.blockers.join("; ") : "No active public positions returned."}</p>
        )}
        {accountState?.orders.length ? (
          <div className="mt-4 max-h-52 overflow-auto rounded border border-white/10">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-terminal-muted">
                <tr>
                  <th className="px-3 py-2">Order</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2">Price</th>
                  <th className="px-3 py-2">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {accountState.orders.slice(0, 6).map((order) => (
                  <tr key={order.id} className="border-t border-white/10">
                    <td className="px-3 py-2 text-slate-200">{order.id ? `${order.id.slice(0, 8)}...${order.id.slice(-4)}` : "--"}</td>
                    <td className="px-3 py-2">{order.side}</td>
                    <td className="px-3 py-2">{order.outcome}</td>
                    <td className="px-3 py-2">{order.price.toFixed(3)}</td>
                    <td className="px-3 py-2">{Math.max(order.originalSize - order.sizeMatched, 0).toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="mt-4 rounded border border-white/10 bg-white/[0.03] p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-64 flex-1 text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="polymarket-cancel-order">
              Cancel Preview
              <input id="polymarket-cancel-order" className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50" value={cancelOrderId} onChange={(event) => setCancelOrderId(event.target.value)} placeholder="0x order id" />
            </label>
            <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={buildCancelPreview}>
              Preview cancel
            </button>
          </div>
          {cancelPreview ? (
            <p className="mt-3 text-xs text-terminal-muted">
              {cancelPreview.cancelReady ? "Cancel preview passed, but execution remains disabled." : cancelPreview.blockers.join("; ")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 rounded-md border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Order Preview</p>
            <p className="mt-1 text-xs text-terminal-muted">Risk calculation only; this does not sign or submit a Polymarket order.</p>
          </div>
          <button className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan" onClick={buildPreview}>
            Preview order
          </button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-5">
          <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="polymarket-market">
            Market
            <input id="polymarket-market" className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50" value={market} onChange={(event) => setMarket(event.target.value)} placeholder="market slug or condition id" />
          </label>
          <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="polymarket-token">
            Token ID
            <input id="polymarket-token" className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50" value={tokenId} onChange={(event) => setTokenId(event.target.value)} placeholder="outcome token id" />
          </label>
          <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="polymarket-side">
            Side
            <select id="polymarket-side" className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50" value={side} onChange={(event) => setSide(event.target.value === "sell" ? "sell" : "buy")}>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="polymarket-price">
            Price
            <input id="polymarket-price" className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50" value={price} onChange={(event) => setPrice(event.target.value)} />
          </label>
          <label className="text-xs uppercase tracking-[0.16em] text-terminal-muted" htmlFor="polymarket-size">
            Size
            <input id="polymarket-size" className="mt-2 w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-cyan-300/50" value={size} onChange={(event) => setSize(event.target.value)} />
          </label>
        </div>
        {preview ? (
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <MetricCard label="Notional" value={`$${preview.preview.notional.toFixed(2)}`} detail={`${preview.preview.side.toUpperCase()} @ ${preview.preview.price ?? "--"}`} icon={<CircleDollarSign className="h-5 w-5" />} tone="cyan" />
            <MetricCard label="Max Loss" value={`$${preview.preview.maxLoss.toFixed(2)}`} detail="Worst-case binary outcome." icon={<ShieldCheck className="h-5 w-5" />} tone="amber" />
            <MetricCard label="Max Profit" value={`$${preview.preview.maxProfit.toFixed(2)}`} detail="Before fees and slippage." icon={<TrendingUp className="h-5 w-5" />} tone="green" />
            <MetricCard label="Preview Gate" value={preview.orderSubmissionReady ? "READY" : "BLOCKED"} detail={preview.nextAction} icon={<Radar className="h-5 w-5" />} tone={preview.orderSubmissionReady ? "green" : "amber"} />
          </div>
        ) : null}
        {preview?.blockers.length ? <p className="mt-3 text-xs text-terminal-muted">{preview.blockers.join("; ")}</p> : null}
      </div>
    </section>
  );
}

function MaintenancePanel() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchMaintenanceStatus();
      setStatus(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load maintenance status.");
    }
  }, []);

  async function runNow() {
    setRunning(true);
    try {
      const run = await runMaintenance();
      setStatus((current) => ({
        schedulerEnabled: current?.schedulerEnabled ?? false,
        schedulerStarted: current?.schedulerStarted ?? false,
        intervalMs: current?.intervalMs ?? 0,
        taskTimeoutMs: current?.taskTimeoutMs,
        running: run.finishedAt === null,
        lastRun: run,
      }));
      for (let attempt = 0; attempt < 5 && run.finishedAt === null; attempt += 1) {
        const next = await fetchMaintenanceStatus();
        setStatus(next);
        if (!next.running) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to run maintenance.");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  const lastRun = status?.lastRun;
  const tasks = lastRun?.tasks ?? [];
  const failedTasks = tasks.filter((task) => task.status === "failed").length;

  return (
    <section id="maintenance" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Maintenance</h2>
          <p className="text-sm text-terminal-muted">Dry-run/status-only checks for source health, Postgres, DeepBook reconcile, and configured-wallet backfill.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={running}
            onClick={refresh}
          >
            Refresh
          </button>
          <button
            className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan disabled:cursor-not-allowed disabled:opacity-50"
            disabled={running}
            onClick={runNow}
          >
            {running ? "Running..." : "Run maintenance"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-4 rounded border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Scheduler</p>
          <p className={`mt-3 text-lg font-semibold ${status?.schedulerEnabled ? "text-terminal-green" : "text-terminal-amber"}`}>
            {status?.schedulerEnabled ? "ENABLED" : "MANUAL"}
          </p>
          <p className="mt-2 text-xs text-terminal-muted">Interval {status ? Math.round(status.intervalMs / 1000) : 0}s.</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Last Run</p>
          <p className={`mt-3 text-lg font-semibold ${lastRun?.status === "success" ? "text-terminal-green" : lastRun ? "text-terminal-amber" : "text-terminal-muted"}`}>
            {lastRun?.status?.toUpperCase() ?? "NONE"}
          </p>
          <p className="mt-2 text-xs text-terminal-muted">{lastRun ? formatTime(lastRun.finishedAt ?? lastRun.startedAt) : "No maintenance run recorded."}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Tasks</p>
          <p className="mt-3 text-lg font-semibold text-terminal-cyan">{tasks.length}</p>
          <p className="mt-2 text-xs text-terminal-muted">{failedTasks} failed task(s).</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Safety</p>
          <p className="mt-3 text-lg font-semibold text-terminal-violet">NO SIGNING</p>
          <p className="mt-2 text-xs text-terminal-muted">Maintenance does not submit orders or spend funds.</p>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.16em] text-terminal-muted">
              <th className="py-3 pr-4">Task</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4">Detail</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length > 0 ? (
              tasks.map((task) => (
                <tr key={`${lastRun?.id}-${task.name}`} className="border-b border-white/[0.06] align-top">
                  <td className="py-4 pr-4 text-slate-200">{task.name}</td>
                  <td className="py-4 pr-4">
                    <StatusPill value={task.status === "failed" ? "critical" : task.status === "skipped" ? "warning" : "healthy"} />
                  </td>
                  <td className="py-4 pr-4 text-terminal-muted">{task.detail}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="py-4 pr-4 text-terminal-muted" colSpan={3}>No maintenance run yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ExecutionHistory() {
  const [state, setState] = useState<DeepBookPositionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await fetchDeepBookPositions();
      setState(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load execution history.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  async function reconcile() {
    setRefreshing(true);
    setMessage(null);
    try {
      const result = await reconcileDeepBookTransactions(10);
      setMessage(`Reconciled ${result.reconciled.length} transaction(s)${result.errors.length > 0 ? `; ${result.errors.length} error(s)` : ""}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reconcile transactions.");
    } finally {
      setRefreshing(false);
    }
  }

  async function backfill() {
    setRefreshing(true);
    setMessage(null);
    try {
      const result = await backfillDeepBookTransactions(undefined, 25);
      setMessage(`Backfilled ${result.recovered.length} transaction(s) from chain history; skipped ${result.skipped.length}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to backfill chain history.");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  const manager = state?.managerSummary;
  const recentTransactions = state?.transactions.slice(0, 8) ?? [];

  return (
    <section id="execution" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Execution History</h2>
          <p className="text-sm text-terminal-muted">Real Sui Testnet DeepBook Predict manager state and persisted chain transaction records.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={refreshing}
            onClick={reconcile}
          >
            Reconcile
          </button>
          <button
            className="rounded border border-white/15 px-3 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={refreshing}
            onClick={backfill}
          >
            Backfill
          </button>
          <button
            className="rounded border border-cyan-300/40 px-3 py-2 text-sm text-terminal-cyan disabled:cursor-not-allowed disabled:opacity-50"
            disabled={refreshing}
            onClick={refresh}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-4 rounded border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{error}</p> : null}
      {message ? <p className="mt-4 rounded border border-cyan-300/30 bg-cyan-300/10 p-3 text-sm text-cyan-100">{message}</p> : null}
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Manager</p>
          <p className="mt-3 text-sm font-semibold">{state?.managerId ? shortObjectId(state.managerId) : "loading"}</p>
          <p className="mt-2 text-xs text-terminal-muted">{manager?.owner ? `Owner ${shortObjectId(manager.owner)}` : state?.managerError ?? "Checking Predict manager."}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Trading Balance</p>
          <p className="mt-3 text-lg font-semibold text-terminal-cyan">{formatDusdcBaseUnits(manager?.trading_balance)}</p>
          <p className="mt-2 text-xs text-terminal-muted">Deposited quote asset available to mint.</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Open Exposure</p>
          <p className="mt-3 text-lg font-semibold text-terminal-amber">{formatDusdcBaseUnits(manager?.open_exposure)}</p>
          <p className="mt-2 text-xs text-terminal-muted">{state ? `${state.lifecycle.openPositions} open position(s).` : "Loading lifecycle."}</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Redeemable</p>
          <p className="mt-3 text-lg font-semibold text-terminal-green">{formatDusdcBaseUnits(manager?.redeemable_value)}</p>
          <p className="mt-2 text-xs text-terminal-muted">{state?.lifecycle.awaitingSettlementPositions ?? 0} awaiting settlement.</p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/[0.035] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-terminal-muted">Withdraw Gate</p>
          <p className={`mt-3 text-lg font-semibold ${state?.lifecycle.canWithdrawQuote ? "text-terminal-green" : "text-terminal-amber"}`}>
            {state?.lifecycle.canWithdrawQuote ? "READY" : "BLOCKED"}
          </p>
          <p className="mt-2 text-xs text-terminal-muted">Requires zero open position and zero open exposure.</p>
        </div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.16em] text-terminal-muted">
              <th className="py-3 pr-4">Action</th>
              <th className="py-3 pr-4">Status</th>
              <th className="py-3 pr-4">Digest</th>
              <th className="py-3 pr-4">Manager</th>
              <th className="py-3 pr-4">Observed</th>
            </tr>
          </thead>
          <tbody>
            {recentTransactions.length > 0 ? (
              recentTransactions.map((event) => (
                <tr key={event.digest} className="border-b border-white/[0.06] align-top">
                  <td className="py-4 pr-4 text-slate-200">{event.action}</td>
                  <td className="py-4 pr-4">
                    <div className="flex flex-col gap-1">
                      <StatusPill value={event.lifecycleStatus === "failed" ? "critical" : event.lifecycleStatus === "pending" || event.lifecycleStatus === "submitted" ? "warning" : "healthy"} />
                      <span className="text-xs text-terminal-muted">{event.lifecycleStatus}</span>
                      {event.failureReason ? <span className="max-w-xs text-xs leading-5 text-red-100">{event.failureReason}</span> : null}
                      {payloadString(event.payload, "failureAdvice") ? <span className="max-w-xs text-xs leading-5 text-terminal-muted">{payloadString(event.payload, "failureAdvice")}</span> : null}
                    </div>
                  </td>
                  <td className="py-4 pr-4">
                    <a className="text-terminal-cyan underline-offset-4 hover:underline" href={suiExplorerTxUrl(event.digest)} target="_blank" rel="noreferrer">
                      {shortObjectId(event.digest)}
                    </a>
                  </td>
                  <td className="py-4 pr-4">{shortObjectId(event.managerId)}</td>
                  <td className="py-4 pr-4 text-terminal-muted">{formatTime(event.observedAt)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="py-4 pr-4 text-terminal-muted" colSpan={5}>No persisted DeepBook chain transactions yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RiskControl({ data }: { data: DashboardApiData }) {
  return (
    <section id="risk" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Risk Control</h2>
          <p className="text-sm text-terminal-muted">Kill-switch rules and active alerts for the research terminal.</p>
        </div>
        <Gauge className="h-5 w-5 text-terminal-amber" />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {data.riskRules.map((rule) => (
          <div key={rule.name} className={`rounded-md border p-4 ${rule.active ? "border-amber-300/30 bg-amber-300/10" : "border-white/10 bg-white/[0.035]"}`}>
            <p className="text-sm font-semibold">{rule.name}</p>
            <p className="mt-2 text-xs text-terminal-muted">{rule.condition}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.14em] text-slate-300">{rule.action}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Dashboard({
  initialData,
  initialError,
}: {
  initialData?: DashboardApiData;
  initialError?: string;
}) {
  const [data, setData] = useState<DashboardApiData | null>(initialData ?? null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const freshData = await fetchDashboardData();
      setData(freshData);
      setError(null);
      setLastRefreshAt(Date.now());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    refreshData()
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled && !data) {
          setError(caught instanceof Error ? caught.message : "Unknown API error");
        }
        setIsRefreshing(false);
      });

    return () => {
      cancelled = true;
    };
  // The initial client refresh should run once after hydration; data is only used
  // to decide whether a failed refresh should replace the first screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshData]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      refreshData().catch(() => {
        setIsRefreshing(false);
      });
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [refreshData]);

  const nav = useMemo(
    () => [
      { label: "Overview", href: "#overview" },
      { label: "Surface", href: "#surface" },
      { label: "Opportunities", href: "#opportunities" },
      { label: "SVI Health", href: "#svi-health" },
      { label: "Audit", href: "#audit" },
      { label: "Testnet", href: "#testnet-readiness" },
      { label: "Polymarket", href: "#polymarket-readiness" },
      { label: "Maintenance", href: "#maintenance" },
      { label: "Wallet", href: "#wallet" },
      { label: "Alerts", href: "#alerts" },
      { label: "Execution", href: "#execution" },
      { label: "Risk", href: "#risk" },
    ],
    [],
  );

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <main className="terminal-grid min-h-screen overflow-x-hidden px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <header className="sticky top-0 z-10 -mx-4 border-b border-white/10 bg-terminal-bg/85 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-terminal-cyan">DeepBook Predict</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">
                BTC Vol-Arb Intelligence Terminal
              </h1>
            </div>
            <nav className="flex max-w-full flex-wrap gap-2 overflow-x-auto text-xs text-terminal-muted">
              {nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded border border-white/10 bg-white/[0.04] px-3 py-2 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-100"
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <StatusPill value={data.overview.systemStatus} />
            <span className="text-terminal-muted">Mode: {data.mode}</span>
            <span className="text-terminal-muted">Refresh: {isRefreshing ? "syncing" : formatTime(lastRefreshAt)}</span>
            <span className="hidden text-terminal-muted sm:inline">API: localhost:4000</span>
          </div>
        </header>

        <div className="space-y-5 py-6">
          <Overview data={data} />
          <SourceStatusPanel data={data} />
          <SurfaceComparison data={data} />
          <OpportunityTable data={data} />
          <SviHealth data={data} />
          <PreTradeAudit data={data} />
          <TestnetReadiness />
          <PolymarketReadiness />
          <MaintenancePanel />
          <section id="wallet" className="scroll-mt-32">
            <WalletTradePanel
              surfaces={data.surfaces}
              oracleId={data.sviHealth[0]?.oracleId}
              oracleStatus={data.sviHealth[0]?.status}
              oracleLagSeconds={data.sviHealth[0]?.lagSeconds}
              oracleExpiry={data.sviHealth[0]?.expiry}
              hasExecutableTrade={data.opportunities.some((opportunity) => opportunity.decision === "trade")}
            />
          </section>
          <AlertPanel data={data} onRefresh={refreshData} />
          <ExecutionHistory />
          <RiskControl data={data} />
        </div>
      </div>
    </main>
  );
}
