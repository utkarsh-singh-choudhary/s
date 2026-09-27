import Link from "next/link";
import { api } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const BAND_STYLE: Record<string, string> = {
  HEALTHY: "bg-green-50 text-good",
  WATCH: "bg-amber-50 text-warn",
  AT_RISK: "bg-orange-50 text-orange-700",
  CRITICAL: "bg-red-50 text-bad",
  UNKNOWN: "bg-gray-100 text-muted",
};

export default async function MachineDetailPage({ params }: { params: { id: string } }) {
  const machineId = params.id;

  const [machine, pmPlans, reliability, breakdowns, health] = await Promise.all([
    safe(() => api.machine(machineId), null),
    safe(() => api.pmList({ machine_id: machineId }), []),
    safe(() => api.reliability(machineId), { machines: [] }),
    safe(() => api.breakdowns({ machine_id: machineId }), []),
    safe(() => api.machineHealthScore(machineId), null),
  ]);

  if (!machine) {
    return (
      <div className="p-6">
        <p className="text-sm text-bad">Machine not found.</p>
        <Link href="/machines" className="text-sm text-accent hover:underline">← Back to machines</Link>
      </div>
    );
  }

  const rel = reliability.machines[0];
  const completed = pmPlans.filter((p) => p.status === "COMPLETED").length;
  const overdue = pmPlans.filter((p) => p.status === "OVERDUE" || p.status === "MISSED").length;
  const sortedPm = [...pmPlans].sort((a, b) => (b.planned_date || "").localeCompare(a.planned_date || ""));

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/machines" className="text-xs text-accent hover:underline">← Machines</Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-lg font-semibold text-ink">
            {machine.machine_number} — {machine.machine_name}
          </h1>
          {machine.critical && <span className="status-pill bg-red-50 text-bad">CRITICAL</span>}
          <StatusPill status={machine.active ? "PLANNED" : "CANCELLED"} />
        </div>
        <p className="text-sm text-muted">{machine.location || "No location on file"}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card">
          <div className="kpi-label">PM Records</div>
          <div className="kpi-value">{pmPlans.length}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Completed</div>
          <div className="kpi-value text-good">{completed}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Overdue / Missed</div>
          <div className={`kpi-value ${overdue ? "text-bad" : "text-ink"}`}>{overdue}</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Open Breakdowns</div>
          <div className={`kpi-value ${rel?.open_breakdowns ? "text-bad" : "text-ink"}`}>{rel?.open_breakdowns ?? 0}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="kpi-card space-y-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <div className="font-medium text-sm">Asset health score</div>
            {health?.band && <span className={`status-pill ${BAND_STYLE[health.band]}`}>{health.band.replace("_", " ")}</span>}
          </div>
          {health?.overall_score != null ? (
            <>
              <div className="text-3xl font-semibold text-ink">{health.overall_score}<span className="text-sm text-muted font-normal"> / 100</span></div>
              <dl className="text-xs space-y-1.5 pt-1">
                {health.factors.map((f) => (
                  <div key={f.key} className="flex justify-between gap-2">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="text-right">{f.score != null ? `${f.score}` : "—"}</dd>
                  </div>
                ))}
              </dl>
              <details className="text-xs text-muted pt-1">
                <summary className="cursor-pointer hover:text-ink">Why these numbers?</summary>
                <ul className="mt-1.5 space-y-1 list-disc list-inside">
                  {health.factors.map((f) => (
                    <li key={f.key}>{f.detail}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="text-sm text-muted">Not enough data yet to compute a health score.</p>
          )}
        </div>

        <div className="kpi-card space-y-3 lg:col-span-1">
          <div className="font-medium text-sm">Machine details</div>
          <dl className="text-sm space-y-2">
            <Row label="Manufacturer" value={machine.manufacturer} />
            <Row label="Specification" value={machine.specification} />
            <Row label="Location" value={machine.location} />
            <Row label="Remarks" value={machine.remarks} />
          </dl>
          <div className="pt-2 border-t border-border">
            <img
              src={api.machineQrcodeUrl(machine.id)}
              alt="Machine QR code"
              className="w-28 h-28 border border-border rounded-sm"
            />
            <p className="text-xs text-muted mt-1">Scan on the shop floor to open this machine.</p>
          </div>
        </div>

        <div className="kpi-card space-y-3 lg:col-span-1">
          <div className="font-medium text-sm">Reliability</div>
          {rel ? (
            <dl className="text-sm space-y-2">
              <Row label="MTBF (hrs)" value={rel.mtbf_hours != null ? rel.mtbf_hours.toFixed(1) : "—"} />
              <Row label="MTTR (hrs)" value={rel.mttr_hours != null ? rel.mttr_hours.toFixed(1) : "—"} />
              <Row label="Total breakdowns" value={String(rel.breakdown_count)} />
              <Row label="Currently down" value={rel.open_breakdowns ? "Yes" : "No"} />
            </dl>
          ) : (
            <p className="text-sm text-muted">No breakdown history yet.</p>
          )}
        </div>

        <div className="kpi-card space-y-2 lg:col-span-1">
          <div className="font-medium text-sm">Checklist template</div>
          {machine.checklist_template_id ? (
            <p className="text-sm text-muted">Assigned — see the checklist under the Checklists page.</p>
          ) : (
            <p className="text-sm text-muted">No checklist template assigned to this machine.</p>
          )}
          <Link href="/checklists" className="text-xs text-accent hover:underline">Manage checklists →</Link>
          <div className="pt-2 border-t border-border">
            <Link href={`/work-orders?machine_id=${machine.id}`} className="text-xs text-accent hover:underline">
              View work orders for this machine →
            </Link>
          </div>
        </div>
      </div>

      <div className="kpi-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-medium text-sm">PM History</div>
        {sortedPm.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No PM records for this machine.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Planned Date</th>
                <th>Month</th>
                <th>Financial Year</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedPm.map((p) => (
                <tr key={p.id}>
                  <td>{p.planned_date || (p.planned_week ? `Week ${p.planned_week}` : "—")}</td>
                  <td>{p.month}</td>
                  <td>{p.financial_year}</td>
                  <td><StatusPill status={p.status} /></td>
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

      <div className="kpi-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-medium text-sm">Breakdown History</div>
        {breakdowns.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No breakdowns logged for this machine.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Resumed</th>
                <th>Cause</th>
                <th>Action taken</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {breakdowns.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.breakdown_at).toLocaleString()}</td>
                  <td>{b.resumed_at ? new Date(b.resumed_at).toLocaleString() : "—"}</td>
                  <td>{b.cause || "—"}</td>
                  <td>{b.action_taken || "—"}</td>
                  <td>
                    {b.is_open ? (
                      <span className="status-pill bg-red-50 text-bad">DOWN</span>
                    ) : (
                      <span className="status-pill bg-green-50 text-good">RESOLVED</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value || "—"}</dd>
    </div>
  );
}
