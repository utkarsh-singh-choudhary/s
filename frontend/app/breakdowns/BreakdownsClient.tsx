"use client";

import { useState } from "react";
import Link from "next/link";
import { api, BreakdownEvent, Machine, ReliabilityRow } from "@/lib/api";

export default function BreakdownsClient({
  initialBreakdowns,
  reliability,
  machines,
}: {
  initialBreakdowns: BreakdownEvent[];
  reliability: ReliabilityRow[];
  machines: Machine[];
}) {
  const [breakdowns, setBreakdowns] = useState(initialBreakdowns);
  const [showForm, setShowForm] = useState(false);
  const [machineId, setMachineId] = useState(machines[0]?.id || "");
  const [cause, setCause] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(false);

  const machineById = new Map(machines.map((m) => [m.id, m]));
  const openCount = breakdowns.filter((b) => b.is_open).length;

  const filteredBreakdowns = breakdowns.filter((b) => {
    if (openOnly && !b.is_open) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const machine = machineById.get(b.machine_id);
    return (
      (machine?.machine_number || "").toLowerCase().includes(q) ||
      (machine?.machine_name || "").toLowerCase().includes(q) ||
      (b.cause || "").toLowerCase().includes(q)
    );
  });

  async function refresh() {
    try {
      const rows = await api.breakdowns();
      setBreakdowns(rows);
    } catch {
      // keep existing list on refresh failure
    }
  }

  async function submitReport(e: React.FormEvent) {
    e.preventDefault();
    if (!machineId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.reportBreakdown({ machine_id: machineId, breakdown_at: new Date().toISOString(), cause: cause || undefined });
      setCause("");
      setShowForm(false);
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to report breakdown");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitResolve(eventId: string, actionTaken: string, scrap: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      await api.resolveBreakdown(eventId, { resumed_at: new Date().toISOString(), action_taken: actionTaken || undefined, resulted_in_scrap_or_replace: scrap });
      setResolvingId(null);
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to resolve breakdown");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Breakdowns</h1>
          <p className="text-sm text-muted">
            {breakdowns.length} logged, <span className={openCount ? "text-bad" : ""}>{openCount} currently down</span>.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90"
        >
          {showForm ? "Cancel" : "Report breakdown"}
        </button>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {showForm && (
        <form onSubmit={submitReport} className="kpi-card space-y-3 max-w-lg">
          <div className="font-medium text-sm">Report a new breakdown</div>
          <div>
            <label className="text-xs text-muted block mb-1">Machine</label>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
            >
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.machine_number} — {m.machine_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Cause (optional)</label>
            <input
              value={cause}
              onChange={(e) => setCause(e.target.value)}
              className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
              placeholder="e.g. bearing failure"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Log breakdown (now)"}
          </button>
        </form>
      )}

      <div className="kpi-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-medium text-sm">Reliability by machine (MTBF / MTTR)</div>
        {reliability.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No breakdown history yet.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Breakdowns</th>
                <th>Open</th>
                <th>MTBF (hrs)</th>
                <th>MTTR (hrs)</th>
              </tr>
            </thead>
            <tbody>
              {reliability.map((r) => (
                <tr key={r.machine_id}>
                  <td>
                    <Link href={`/machines/${r.machine_id}`} className="text-accent hover:underline">
                      {r.machine_number} — {r.machine_name}
                    </Link>
                  </td>
                  <td>{r.breakdown_count}</td>
                  <td className={r.open_breakdowns ? "text-bad font-medium" : ""}>{r.open_breakdowns}</td>
                  <td>{r.mtbf_hours != null ? r.mtbf_hours.toFixed(1) : "—"}</td>
                  <td>{r.mttr_hours != null ? r.mttr_hours.toFixed(1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="kpi-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-center gap-3">
          <div className="font-medium text-sm mr-auto">Breakdown Log</div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search machine or cause…"
            className="border border-border rounded-sm px-2 py-1 text-xs w-56"
          />
          <label className="text-xs flex items-center gap-1.5">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open only
          </label>
        </div>
        {filteredBreakdowns.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No breakdowns match this filter.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Started</th>
                <th>Resumed</th>
                <th>Cause</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredBreakdowns.map((b) => {
                const machine = machineById.get(b.machine_id);
                return (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/machines/${b.machine_id}`} className="text-accent hover:underline">
                        {machine ? machine.machine_number : b.machine_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{new Date(b.breakdown_at).toLocaleString()}</td>
                    <td>{b.resumed_at ? new Date(b.resumed_at).toLocaleString() : "—"}</td>
                    <td>{b.cause || "—"}</td>
                    <td>
                      {b.is_open ? (
                        <span className="status-pill bg-red-50 text-bad">DOWN</span>
                      ) : (
                        <span className="status-pill bg-green-50 text-good">RESOLVED</span>
                      )}
                    </td>
                    <td>
                      {b.is_open && (
                        resolvingId === b.id ? (
                          <ResolveInline
                            submitting={submitting}
                            onCancel={() => setResolvingId(null)}
                            onSubmit={(action, scrap) => submitResolve(b.id, action, scrap)}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <button onClick={() => setResolvingId(b.id)} className="text-xs text-accent hover:underline">
                              Mark resolved
                            </button>
                            <Link href={`/work-orders?machine_id=${b.machine_id}`} className="text-xs text-muted hover:underline">
                              Raise WO
                            </Link>
                          </div>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ResolveInline({
  submitting,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (actionTaken: string, scrap: boolean) => void;
}) {
  const [action, setAction] = useState("");
  const [scrap, setScrap] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={action}
        onChange={(e) => setAction(e.target.value)}
        placeholder="Action taken"
        className="border border-border rounded-sm px-1.5 py-0.5 text-xs w-32"
      />
      <label className="text-xs flex items-center gap-1">
        <input type="checkbox" checked={scrap} onChange={(e) => setScrap(e.target.checked)} />
        Scrap
      </label>
      <button
        disabled={submitting}
        onClick={() => onSubmit(action, scrap)}
        className="text-xs text-good hover:underline disabled:opacity-50"
      >
        Save
      </button>
      <button onClick={onCancel} className="text-xs text-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}
