"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, PMPlan, Machine, BulkCompleteResult } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";

const NOT_SELECTABLE = new Set(["COMPLETED", "CANCELLED"]);

const SKIP_REASON_LABEL: Record<string, string> = {
  not_found: "Plan no longer exists",
  already_completed: "Already completed",
  already_cancelled: "Cancelled",
  already_pending_supervisor_confirmation: "Awaiting supervisor confirmation",
  requires_checklist: "Has a required checklist — complete individually",
};

export default function PMPlansClient({ rows, machines }: { rows: PMPlan[]; machines: Machine[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkCompleteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const selectableRows = rows.filter((p) => !NOT_SELECTABLE.has(p.status));
  const allSelected = selectableRows.length > 0 && selectableRows.every((p) => selected.has(p.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) return new Set();
      return new Set(selectableRows.map((p) => p.id));
    });
  }

  async function runBulkComplete() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.bulkCompletePM(Array.from(selected));
      setResult(res);
      setSelected(new Set());
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Bulk complete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-sm border border-border bg-panel px-3 py-2">
          <span className="text-sm text-ink">{selected.size} selected</span>
          <button
            onClick={runBulkComplete}
            disabled={busy}
            className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Completing…" : `Bulk Complete (${selected.size})`}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted hover:underline">
            Clear selection
          </button>
        </div>
      )}

      {error && <div className="text-sm text-bad">{error}</div>}

      {result && (
        <div className="rounded-sm border border-border bg-panel px-3 py-2 text-sm space-y-1">
          <div className="text-ink">
            {result.completed.length} completed
            {result.pending_confirmation.length > 0 && `, ${result.pending_confirmation.length} awaiting supervisor confirmation`}
            {result.skipped.length > 0 && `, ${result.skipped.length} skipped`}
            {" "}of {result.requested} requested.
          </div>
          {result.skipped.length > 0 && (
            <ul className="text-xs text-muted list-disc list-inside">
              {result.skipped.map((s) => (
                <li key={s.id}>
                  {s.machine_number || s.id.slice(0, 8)} — {SKIP_REASON_LABEL[s.reason] || s.reason}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setResult(null)} className="text-xs text-accent hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="kpi-card !p-0 overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No PM plans match this filter.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th>Machine</th>
                <th>Planned Date</th>
                <th>Month</th>
                <th>FY</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const machine = machineById.get(p.machine_id);
                const selectable = !NOT_SELECTABLE.has(p.status);
                return (
                  <tr key={p.id}>
                    <td>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          aria-label={`Select ${machine?.machine_number || p.id}`}
                        />
                      )}
                    </td>
                    <td>
                      <Link href={`/machines/${p.machine_id}`} className="text-accent hover:underline">
                        {machine ? `${machine.machine_number} — ${machine.machine_name}` : p.machine_id.slice(0, 8)}
                      </Link>
                    </td>
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
