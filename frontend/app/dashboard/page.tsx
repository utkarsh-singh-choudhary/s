import { api, PMPlan } from "@/lib/api";
import { KpiCard } from "@/components/KpiCard";
import { StatusPill } from "@/components/StatusPill";
import Link from "next/link";
import { effectiveStatus, daysOverdue } from "@/lib/pmStatus";
import { fmtDate, fmtHours, fmtMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function DashboardPage() {
  const [machines, upcoming, overdue, allPlans, kpis, attention] = await Promise.all([
    safe(() => api.machines(), []),
    safe(() => api.pmUpcoming(14), []),
    safe(() => api.pmOverdue(), []),
    safe(() => api.pmAll(), []),
    safe(() => api.kpis({ date_preset: "this_month" }), null),
    safe(() => api.attention(), { items: [], total: 0 }),
  ]);

  const machineLabels: Record<string, string> = {};
  machines.forEach((m) => {
    machineLabels[m.id] = `${m.machine_number} — ${m.machine_name}`;
  });

  const completed = allPlans.filter((p) => p.status === "COMPLETED").length;
  const planned = allPlans.length;
  const completionPct = planned ? Math.round((completed / planned) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Preventive Maintenance Dashboard</h1>
        <p className="text-sm text-muted">Live status across all machines, FY 26-27.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Machines" value={machines.length} />
        <KpiCard label="PM Planned" value={planned} />
        <KpiCard label="PM Completed" value={completed} tone="good" />
        <KpiCard label="PM Upcoming (14d)" value={upcoming.length} tone="warn" />
        <KpiCard label="PM Overdue" value={overdue.length} tone={overdue.length ? "bad" : "good"} />
        <KpiCard label="Completion %" value={`${completionPct}%`} tone={completionPct >= 90 ? "good" : "warn"} />
      </div>

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard label="Breakdowns this month" value={kpis.breakdowns.new} tone={kpis.breakdowns.new ? "warn" : "good"} />
          <KpiCard label="Open breakdowns" value={kpis.breakdowns.open} tone={kpis.breakdowns.open ? "bad" : "good"} />
          <KpiCard label="Repeat failures" value={kpis.breakdowns.recurring} />
          <KpiCard label="Downtime this month" value={fmtHours(kpis.downtime.hours)} />
          <KpiCard label="Maintenance spend" value={fmtMoney(kpis.spend.total, kpis.currency)} />
          <KpiCard label="PM missed" value={kpis.pm.missed} tone={kpis.pm.missed ? "bad" : "good"} />
        </div>
      )}

      {attention.items.length > 0 && (
        <div className="kpi-card space-y-1.5">
          <div className="font-medium text-sm">Needs attention</div>
          <ul className="text-sm space-y-1">
            {attention.items.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`status-pill ${a.severity === "high" ? "bg-red-50 text-bad" : a.severity === "medium" ? "bg-amber-50 text-warn" : "bg-surface text-muted"}`}>
                  {a.severity.toUpperCase()}
                </span>
                {a.link ? <Link href={a.link} className="text-accent hover:underline">{a.text}</Link> : <span>{a.text}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PlanTable title="Upcoming Maintenance" plans={upcoming} machineLabels={machineLabels} emptyText="No PM due in the next 14 days." />
        <PlanTable title="Overdue Maintenance" plans={overdue} machineLabels={machineLabels} emptyText="Nothing overdue." highlightOverdue />
      </div>
    </div>
  );
}

function PlanTable({
  title,
  plans,
  emptyText,
  highlightOverdue,
  machineLabels,
}: {
  title: string;
  plans: PMPlan[];
  emptyText: string;
  highlightOverdue?: boolean;
  machineLabels: Record<string, string>;
}) {
  return (
    <div className="kpi-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-medium text-sm">{title}</div>
      {plans.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted">{emptyText}</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Machine</th>
              <th>Planned Date</th>
              {highlightOverdue && <th>Days Overdue</th>}
              <th>Month</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td className="text-sm">
                  <Link href={`/machines/${p.machine_id}`} className="text-accent hover:underline">
                    {machineLabels[p.machine_id] || p.machine_id.slice(0, 8)}
                  </Link>
                </td>
                <td>{p.planned_date ? fmtDate(p.planned_date) : "—"}</td>
                {highlightOverdue && <td className="text-bad font-medium">{daysOverdue(p.planned_date)}</td>}
                <td>{p.month}</td>
                <td>
                  <StatusPill status={highlightOverdue ? "OVERDUE" : effectiveStatus(p.status, p.planned_date)} />
                </td>
                <td>
                  {p.status !== "COMPLETED" && p.status !== "CANCELLED" && (
                    <Link href={`/pm/${p.id}/complete`} className="text-xs text-accent hover:underline">
                      Complete
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
