"use client";

import { useState } from "react";
import { api, CostReport, DataQualityReport, MonthlyReport } from "@/lib/api";
import { KpiCard } from "@/components/KpiCard";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function ReportsClient() {
  const [month, setMonth] = useState("September");
  const [financialYear, setFinancialYear] = useState("26-27");
  const [tab, setTab] = useState<"monthly" | "quality" | "cost">("monthly");
  const [monthly, setMonthly] = useState<MonthlyReport | null>(null);
  const [quality, setQuality] = useState<DataQualityReport | null>(null);
  const [cost, setCost] = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (tab === "monthly") {
        setMonthly(await api.monthlyReport(month, financialYear));
      } else if (tab === "quality") {
        setQuality(await api.dataQualityReport(financialYear));
      } else {
        setCost(await api.costReport());
      }
    } catch (err: any) {
      setError(err.message || "Failed to load report");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">Reports</h1>
        <p className="text-sm text-muted">Monthly compliance and data-quality reporting.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setTab("monthly")}
            className={`text-xs px-2.5 py-1 rounded-sm border ${tab === "monthly" ? "bg-ink text-white border-ink" : "bg-panel text-muted border-border"}`}
          >
            Monthly Compliance
          </button>
          <button
            onClick={() => setTab("quality")}
            className={`text-xs px-2.5 py-1 rounded-sm border ${tab === "quality" ? "bg-ink text-white border-ink" : "bg-panel text-muted border-border"}`}
          >
            Data Quality
          </button>
          <button
            onClick={() => setTab("cost")}
            className={`text-xs px-2.5 py-1 rounded-sm border ${tab === "cost" ? "bg-ink text-white border-ink" : "bg-panel text-muted border-border"}`}
          >
            Cost Analytics
          </button>
        </div>

        {tab === "monthly" && (
          <div>
            <label className="text-xs text-muted block mb-1">Month</label>
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
              {MONTHS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs text-muted block mb-1">Financial Year</label>
          <input
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
            className="border border-border rounded-sm px-2 py-1.5 text-sm w-24"
          />
        </div>
        <button onClick={load} disabled={loading} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
          {loading ? "Loading…" : "Run report"}
        </button>

        {tab === "monthly" && (
          <div className="flex gap-2 ml-auto">
            <a href={api.monthlyReportFileUrl(month, financialYear, "pdf")} className="text-xs text-accent hover:underline self-center">
              Download PDF
            </a>
            <a href={api.monthlyReportFileUrl(month, financialYear, "xlsx")} className="text-xs text-accent hover:underline self-center">
              Download Excel
            </a>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {tab === "monthly" && monthly && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <KpiCard label="Planned" value={monthly.total_planned} />
            <KpiCard label="Completed" value={monthly.completed} tone="good" />
            <KpiCard label="Pending" value={monthly.pending} tone="warn" />
            <KpiCard label="Overdue" value={monthly.overdue} tone={monthly.overdue ? "bad" : "good"} />
            <KpiCard label="Completion %" value={`${(monthly.completion_rate * 100).toFixed(0)}%`} tone={monthly.completion_rate >= 0.9 ? "good" : "warn"} />
            <KpiCard label="On-time %" value={`${(monthly.on_time_rate * 100).toFixed(0)}%`} tone={monthly.on_time_rate >= 0.8 ? "good" : "warn"} />
          </div>

          <ReportTable title="By Location" rows={monthly.location_rows} />
          <ReportTable title="By Employee" rows={monthly.employee_rows} />
          <ReportTable title="Overdue List" rows={monthly.overdue_list} />
        </div>
      )}

      {tab === "quality" && quality && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="Total Issues" value={quality.total_issues} tone={quality.total_issues ? "warn" : "good"} />
            <KpiCard label="Missing Responsible" value={quality.machines_missing_responsible.length} />
            <KpiCard label="Plan Gaps" value={quality.machines_with_plan_gaps.length} />
            <KpiCard label="Missing Location" value={quality.machines_missing_location.length} />
            <KpiCard label="Needs Review" value={quality.plans_needing_review.length} />
          </div>

          <ReportTable title="Machines Missing Responsible Person" rows={quality.machines_missing_responsible} />
          <ReportTable title="Machines With Plan Gaps" rows={quality.machines_with_plan_gaps} />
          <ReportTable title="Machines Missing Location" rows={quality.machines_missing_location} />
          <ReportTable title="PM Plans Needing Review" rows={quality.plans_needing_review} />
          <ReportTable title="Potential Duplicate Machines" rows={quality.potential_duplicate_machines} />
        </div>
      )}

      {tab === "cost" && cost && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            {cost.start_date} to {cost.end_date} — assumes ₹{cost.labor_hour_cost}/labor hour and ₹{cost.downtime_minute_cost}/downtime minute (adjustable in Admin settings).
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="Total Cost" value={`₹${cost.grand_total.toLocaleString()}`} />
            <KpiCard label="Preventive" value={`₹${cost.preventive.total_cost.toLocaleString()}`} tone="good" />
            <KpiCard label="Corrective" value={`₹${cost.corrective.total_cost.toLocaleString()}`} tone={cost.corrective.total_cost > cost.preventive.total_cost ? "bad" : "warn"} />
            <KpiCard label="Work Orders" value={cost.corrective.work_order_count} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="kpi-card space-y-1.5">
              <div className="font-medium text-sm mb-1">Preventive</div>
              <Row label="PMs completed" value={String(cost.preventive.pm_count)} />
              <Row label="Downtime cost" value={`₹${cost.preventive.downtime_cost.toLocaleString()}`} />
            </div>
            <div className="kpi-card space-y-1.5">
              <div className="font-medium text-sm mb-1">Corrective</div>
              <Row label="Labor cost" value={`₹${cost.corrective.labor_cost.toLocaleString()}`} />
              <Row label="Downtime cost" value={`₹${cost.corrective.downtime_cost.toLocaleString()}`} />
              <Row label="Parts cost" value={`₹${cost.corrective.parts_cost.toLocaleString()}`} />
            </div>
          </div>

          <div className="kpi-card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-medium text-sm">Cost by Machine ({cost.by_machine.length})</div>
            {cost.by_machine.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted">No corrective work orders in this window.</div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Machine</th>
                    <th>Work Orders</th>
                    <th>Labor</th>
                    <th>Downtime</th>
                    <th>Parts</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.by_machine.map((m) => (
                    <tr key={m.machine_id}>
                      <td>{m.machine_number ? `${m.machine_number} — ${m.machine_name}` : m.machine_id.slice(0, 8)}</td>
                      <td>{m.work_orders}</td>
                      <td>₹{m.labor_cost.toLocaleString()}</td>
                      <td>₹{m.downtime_cost.toLocaleString()}</td>
                      <td>₹{m.parts_cost.toLocaleString()}</td>
                      <td className="font-medium">₹{m.total_cost.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {!monthly && !quality && !cost && !loading && !error && (
        <div className="kpi-card text-sm text-muted">Choose a period and run a report.</div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function ReportTable({ title, rows }: { title: string; rows: any[] }) {
  if (!rows || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  return (
    <div className="kpi-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-medium text-sm">{title} ({rows.length})</div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c.replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{formatCell(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatCell(value: any): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "number" && !Number.isInteger(value)) return value.toFixed(2);
  return String(value);
}
