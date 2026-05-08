"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  BellRing,
  AlertTriangle,
  BarChart3,
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
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardApiData } from "../../lib/api-client";
import { fetchDashboardData } from "../../lib/api-client";
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
        label="Paper PnL"
        value={money.format(data.overview.openPaperPnl)}
        detail={data.overview.killSwitchActive ? "Dry-run or full-stop control active." : "Kill switch inactive."}
        icon={<ShieldCheck className="h-5 w-5" />}
        tone="violet"
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

function AlertPanel({ data }: { data: DashboardApiData }) {
  return (
    <section id="alerts" className="scroll-mt-32 rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Alert System</h2>
          <p className="text-sm text-terminal-muted">Source, risk, SVI, and opportunity alerts generated from the current pipeline.</p>
        </div>
        <BellRing className="h-5 w-5 text-terminal-amber" />
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        {data.alerts.length === 0 ? (
          <div className="rounded-md border border-white/10 bg-white/[0.035] p-4 text-sm text-terminal-muted">No active alerts.</div>
        ) : (
          data.alerts.slice(0, 6).map((alert) => (
            <div key={alert.alertId} className={`rounded-md border p-4 ${alert.severity === "critical" ? "border-red-300/30 bg-red-300/10" : "border-amber-300/30 bg-amber-300/10"}`}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">{alert.title}</p>
                <span className="text-xs uppercase tracking-[0.14em] text-slate-300">{alert.severity}</span>
              </div>
              <p className="mt-2 text-xs text-slate-300">{alert.message}</p>
              <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-terminal-muted">{alert.sourceId}</p>
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

function PaperTrading({ data }: { data: DashboardApiData }) {
  const attribution = data.paperTrades[0]?.attribution;
  const bars = attribution
    ? [
        { name: "Vol edge", value: attribution.volEdgePnl },
        { name: "Delta", value: attribution.deltaPnl },
        { name: "Hedge", value: attribution.hedgePnl },
        { name: "Funding", value: attribution.fundingPnl },
        { name: "Fees", value: attribution.fees },
        { name: "Slippage", value: attribution.slippage },
      ]
    : [];

  return (
    <section id="paper" className="scroll-mt-32 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
        <h2 className="text-lg font-semibold">Paper Trading</h2>
        <p className="text-sm text-terminal-muted">Dry-run fills and position state. No real order is submitted.</p>
        <div className="mt-5 grid gap-3">
          {data.paperTrades.map((trade) => (
            <div key={trade.tradeId} className="rounded-md border border-white/10 bg-white/[0.035] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium">{trade.tradeId}</p>
                <span className="text-sm text-terminal-green">{money.format(trade.currentPnl)}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{trade.hedgePlan}</p>
              <p className="mt-2 text-xs text-terminal-muted">Fill {trade.simulatedFill} · entry {trade.entryPrice} · {trade.status}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-white/10 bg-terminal-panel/90 p-5">
        <h2 className="text-lg font-semibold">PnL Attribution</h2>
        <p className="text-sm text-terminal-muted">Separates volatility edge from residual directional and execution effects.</p>
        <div className="mt-6 h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" />
              <XAxis dataKey="name" stroke="#7e8da3" />
              <YAxis stroke="#7e8da3" />
              <Tooltip contentStyle={{ background: "#0e141b", border: "1px solid #26313e", borderRadius: 8 }} />
              <Bar isAnimationActive={false} dataKey="value" fill="#2ce6d1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
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

export function Dashboard() {
  const [data, setData] = useState<DashboardApiData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboardData()
      .then(setData)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unknown API error"));
  }, []);

  const nav = useMemo(
    () => [
      { label: "Overview", href: "#overview" },
      { label: "Surface", href: "#surface" },
      { label: "Opportunities", href: "#opportunities" },
      { label: "SVI Health", href: "#svi-health" },
      { label: "Wallet", href: "#wallet" },
      { label: "Alerts", href: "#alerts" },
      { label: "Paper", href: "#paper" },
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
            <span className="hidden text-terminal-muted sm:inline">API: localhost:4000</span>
          </div>
        </header>

        <div className="space-y-5 py-6">
          <Overview data={data} />
          <SourceStatusPanel data={data} />
          <SurfaceComparison data={data} />
          <OpportunityTable data={data} />
          <SviHealth data={data} />
          <section id="wallet" className="scroll-mt-32">
            <WalletTradePanel surfaces={data.surfaces} oracleId={data.sviHealth[0]?.oracleId} />
          </section>
          <AlertPanel data={data} />
          <PaperTrading data={data} />
          <RiskControl data={data} />
        </div>
      </div>
    </main>
  );
}
