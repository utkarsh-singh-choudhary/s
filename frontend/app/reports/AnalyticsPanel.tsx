"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, AnalyticsOverview, AttentionItem, Workload } from "@/lib/api";
import { KpiCard } from "@/components/KpiCard";
import { DateField } from "@/components/DateField";
import { DATE_PRESETS } from "@/components/FilterBar";
import { fmtDate, fmtHours, fmtMinutes, fmtMoney } from "@/lib/format";

const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${v}%`);

function Bars({ rows, tone = "bg-accent" }: { rows: { name: string; value: number }[]; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted">No data in this period.</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2 text-xs">
          <div className="w-40 truncate" title={r.name}>{r.name}</div>
          <div className="flex-1 bg-surface rounded-sm h-3 overflow-hidden">
            <div className={`${tone} h-3`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="w-10 text-right">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsPanel() {
  const [preset, setPreset] = useState("this_fy");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [attention, setAttention] = useState<AttentionItem[]>([]);
  const [workload, setWorkload] = useState<Workload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.analytics({
        date_preset: preset,
        date_from: preset === "custom" ? from || undefined : undefined,
        date_to: preset === "custom" ? to || undefined : undefined,
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [preset, from, to]);
  useEffect(() => {
    api.attention().then((r) => setAttention(r.items)).catch(() => {});
    api.workload().then(setWorkload).catch(() => {});
  }, []);

  const s = data?.summary;
  const cur = s?.currency;
  const sel = "border border-border rounded-sm px-2 py-1.5 text-sm";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted block mb-1">Period</label>
          <select value={preset} onChange={(e) => setPreset(e.target.value)} className={sel}>
            {DATE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
        {preset === "custom" && (
          <>
            <div><label className="text-xs text-muted block mb-1">From</label><DateField value={from} onChange={setFrom} /></div>
            <div><label className="text-xs text-muted block mb-1">To</label><DateField value={to} onChange={setTo} /></div>
          </>
        )}
        {s && <span className="text-xs text-muted pb-2">{fmtDate(s.period_from)} to {fmtDate(s.period_to)}</span>}
        {loading && <span className="text-xs text-muted pb-2">Loading…</span>}
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {attention.length > 0 && (
        <div className="kpi-card space-y-1.5">
          <div className="font-medium text-sm">Needs attention</div>
          <ul className="text-sm space-y-1">
            {attention.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`status-pill ${a.severity === "high" ? "bg-red-50 text-bad" : a.severity === "medium" ? "bg-amber-50 text-warn" : "bg-surface text-muted"}`}>{a.severity.toUpperCase()}</span>
                {a.link ? <Link href={a.link} className="text-accent hover:underline">{a.text}</Link> : <span>{a.text}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Breakdowns" value={s.breakdowns} />
            <KpiCard label="Repeat failures" value={`${s.repeat_failures} (${pct(s.repeat_rate_pct)})`} tone={s.repeat_failures ? "warn" : "good"} />
            <KpiCard label="MTTR" value={s.mttr_hours == null ? "n/a" : fmtHours(s.mttr_hours)} />
            <KpiCard label="Downtime" value={fmtMinutes(s.downtime_minutes)} />
            <KpiCard label="Downtime cost" value={fmtMoney(s.downtime_cost, cur)} />
            <KpiCard label="Maintenance cost" value={fmtMoney(s.maintenance_cost, cur)} />
            <KpiCard label="PM compliance" value={pct(s.pm_compliance_pct)} tone={s.pm_compliance_pct != null && s.pm_compliance_pct >= 90 ? "good" : "warn"} />
            <KpiCard label="PM on time" value={pct(s.pm_on_time_pct)} />
          </div>

          <div className="kpi-card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-medium text-sm">By machine ({data!.machines.length})</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Machine</th><th>Breakdowns</th><th>Repeat</th><th>Downtime</th><th>MTTR</th><th>MTBF</th><th>PM done / due</th><th>PM %</th><th>Cost</th></tr></thead>
                <tbody>
                  {data!.machines.map((m) => (
                    <tr key={m.machine_id}>
                      <td><Link href={`/machines/${m.machine_id}`} className="text-accent hover:underline">{m.machine_number} — {m.machine_name}</Link>{m.critical && <span className="status-pill bg-red-50 text-bad ml-1">CRITICAL</span>}</td>
                      <td>{m.breakdown_count}</td>
                      <td>{m.repeat_count}</td>
                      <td>{fmtMinutes(m.downtime_minutes)}</td>
                      <td>{m.mttr_hours == null ? "—" : fmtHours(m.mttr_hours)}</td>
                      <td title={m.mtbf_status === "insufficient_data" ? `Needs at least ${s.mtbf_min_failures} failures` : undefined}>
                        {m.mtbf_status === "ok" ? fmtHours(m.mtbf_hours) : m.mtbf_status === "no_failures" ? "No failures" : <span className="text-muted">Not enough data</span>}
                      </td>
                      <td>{m.pm_completed} / {m.pm_due}</td>
                      <td>{pct(m.pm_compliance_pct)}</td>
                      <td>{fmtMoney(m.maintenance_cost, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="kpi-card space-y-2">
              <div className="font-medium text-sm">Failure categories</div>
              <Bars rows={data!.failure_categories.map((r) => ({ name: r.name, value: r.count }))} />
            </div>
            <div className="kpi-card space-y-2">
              <div className="font-medium text-sm">Top failure modes</div>
              <Bars rows={data!.failure_modes.map((r) => ({ name: r.name, value: r.count }))} tone="bg-warn" />
            </div>
          </div>

          <div className="kpi-card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-medium text-sm">Monthly trend</div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Month</th><th>Breakdowns</th><th>Downtime</th><th>Cost</th><th>PM done / due</th></tr></thead>
                <tbody>
                  {data!.trend.map((t) => (
                    <tr key={t.month}><td>{t.month}</td><td>{t.breakdowns}</td><td>{fmtMinutes(t.downtime_minutes)}</td><td>{fmtMoney(t.cost, cur)}</td><td>{t.pm_completed} / {t.pm_due}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data!.overdue_critical.length > 0 && (
            <div className="kpi-card !p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-border font-medium text-sm text-bad">Overdue PM on critical machines ({data!.overdue_critical.length})</div>
              <table className="data-table">
                <thead><tr><th>Machine</th><th>Planned</th><th>Days overdue</th><th></th></tr></thead>
                <tbody>
                  {data!.overdue_critical.map((o) => (
                    <tr key={o.pm_id}>
                      <td>{o.machine_number} — {o.machine_name}</td><td>{fmtDate(o.planned_date)}</td><td className="text-bad">{o.days_overdue}</td>
                      <td><Link href={`/pm/${o.pm_id}`} className="text-xs text-accent hover:underline">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {workload && (workload.people.length > 0 || workload.conflicts.length > 0) && (
        <div className="kpi-card space-y-3">
          <div className="font-medium text-sm">Workload, {fmtDate(workload.from)} to {fmtDate(workload.to)}</div>
          {workload.conflicts.length > 0 && (
            <ul className="text-sm text-warn list-disc list-inside">
              {workload.conflicts.map((c, i) => <li key={i}>{c.text}</li>)}
            </ul>
          )}
          <table className="data-table">
            <thead><tr><th>Person</th><th>Work orders</th><th>In progress</th><th>PM plans</th><th>Estimated hours</th></tr></thead>
            <tbody>
              {workload.people.map((p) => (
                <tr key={p.employee_id}><td>{p.name || p.employee_id.slice(0, 8)}</td><td>{p.work_orders}</td><td>{p.in_progress}</td><td>{p.pm_plans}</td><td>{p.estimated_hours}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <details className="kpi-card text-sm">
          <summary className="cursor-pointer font-medium">How these numbers are calculated</summary>
          <dl className="mt-2 space-y-1.5">
            {Object.entries(data.definitions).map(([k, v]) => (
              <div key={k}><dt className="font-medium inline">{k}: </dt><dd className="inline text-muted">{v}</dd></div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
