import type { Decision, HealthStatus } from "@vol-arb/core";

const statusClasses: Record<HealthStatus | Decision, string> = {
  healthy: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  stale: "border-orange-400/40 bg-orange-400/10 text-orange-100",
  critical: "border-red-400/40 bg-red-400/10 text-red-100",
  trade: "border-emerald-400/50 bg-emerald-400/15 text-emerald-100",
  watch: "border-cyan-300/40 bg-cyan-300/10 text-cyan-100",
  reject: "border-red-400/40 bg-red-400/10 text-red-100",
};

export function StatusPill({ value }: { value: HealthStatus | Decision }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${statusClasses[value]}`}>
      {value}
    </span>
  );
}
