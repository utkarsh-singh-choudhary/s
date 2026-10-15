"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { api, PMRow, PMSummary, Paged, Machine, Employee, BulkCompleteResult } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { defaultFilters, FilterBar, filterParams, FilterState } from "@/components/FilterBar";
import { Pagination } from "@/components/Pagination";
import { KpiCard } from "@/components/KpiCard";
import { fmtDate, label } from "@/lib/format";

const STATUS_OPTIONS = [
  "OPEN", "PLANNED", "DUE", "IN_PROGRESS", "COMPLETED", "OVERDUE", "MISSED", "CANCELLED", "PENDING_SUPERVISOR_CONFIRMATION",
];

const NOT_SELECTABLE = new Set(["COMPLETED", "CANCELLED"]);
const NOT_RESCHEDULABLE = new Set(["COMPLETED", "PENDING_SUPERVISOR_CONFIRMATION"]);

const SKIP_REASON_LABEL: Record<string, string> = {
  not_found: "Plan no longer exists",
  already_completed: "Already completed",
  already_cancelled: "Cancelled",
  already_pending_supervisor_confirmation: "Awaiting supervisor confirmation",
  requires_checklist: "Has a required checklist — complete individually",
};

export default function PMPlansClient({
  machines, employees, initialStatus, initialMachineId,
}: { machines: Machine[]; employees: Employee[]; initialStatus: string; initialMachineId: string }) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters({ date_basis: "planned" }));
  const [status, setStatus] = useState(initialStatus);
  const [machineId, setMachineId] = useState(initialMachineId);
  const [assignedTo, setAssignedTo] = useState("");
  const [data, setData] = useState<Paged<PMRow, PMSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const router = { refresh: () => setTick((t) => t + 1) };
  const rows = data?.items || [];
  const extra = { status, machine_id: machineId, assigned_to: assignedTo };
  const params = { ...filterParams(filters), ...extra };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.searchPM(params));
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params), tick]);
  useEffect(() => { load(); }, [load]);
  const reset = (fn: () => void) => { fn(); setFilters((f) => ({ ...f, page: 1 })); };
  const sel = "border border-border rounded-sm px-2 py-1.5 text-sm";
  const sm = data?.summary;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkCompleteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editAssignee, setEditAssignee] = useState("");

  const me = getUser();
  const canReschedule = me?.role === "SUPERVISOR" || me?.role === "MANAGER" || me?.role === "ADMIN";
  const canExport = canReschedule;

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

  function startEdit(p: PMRow) {
    setEditingId(p.id);
    setEditDate(p.planned_date || "");
    setEditAssignee(p.assigned_to || "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.updatePM(id, { planned_date: editDate || null, assigned_to: editAssignee || null });
      setEditingId(null);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to reschedule PM plan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">PM Plans</h1>
        <p className="text-sm text-muted">Planned and completed preventive maintenance, with the dates, people and evidence behind each one.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Matching" value={sm?.total ?? "—"} />
        <KpiCard label="Completed" value={sm?.completed ?? "—"} />
        <KpiCard label="Planned" value={sm?.planned ?? "—"} />
        <KpiCard label="Overdue" value={sm?.overdue ?? "—"} tone={sm && sm.overdue > 0 ? "bad" : undefined} />
        <KpiCard label="Missed" value={sm?.missed ?? "—"} tone={sm && sm.missed > 0 ? "bad" : undefined} />
        <KpiCard label="Awaiting confirm" value={sm?.pending_confirmation ?? "—"} />
      </div>

      <FilterBar
        value={filters} onChange={setFilters}
        basisOptions={[{ value: "planned", label: "Planned date" }, { value: "actual", label: "Completed date" }]}
        sortOptions={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "machine", label: "Machine" }, { value: "downtime", label: "Downtime" }]}
        canExport={canExport}
        onExport={(fmt) => api.exportPM({ ...filterParams(filters), ...extra, page: undefined, page_size: undefined }, fmt)}
        rangeLabel={data?.range}
      >
        <div><label className="text-xs text-muted block mb-1">Status</label>
          <select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className={sel}>
            <option value="">All</option>{STATUS_OPTIONS.map((x) => <option key={x} value={x}>{label(x)}</option>)}
          </select></div>
        <div><label className="text-xs text-muted block mb-1">Machine</label>
          <select value={machineId} onChange={(e) => reset(() => setMachineId(e.target.value))} className={`${sel} max-w-[160px]`}>
            <option value="">All</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number}</option>)}
          </select></div>
        <div><label className="text-xs text-muted block mb-1">Assigned to</label>
          <select value={assignedTo} onChange={(e) => reset(() => setAssignedTo(e.target.value))} className={`${sel} max-w-[160px]`}>
            <option value="">Anyone</option>{employees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
      </FilterBar>

      {loadError && <div className="text-sm text-bad">{loadError}</div>}

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

      <div className={`kpi-card !p-0 overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        {rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">{loading ? "Loading…" : "No PM plans match these filters."}</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
                <th>Machine</th>
                <th>Planned</th>
                <th>Completed</th>
                <th>Assigned To</th>
                <th>Completed by</th>
                <th>Files</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const selectable = !NOT_SELECTABLE.has(p.status);
                const reschedulable = canReschedule && !NOT_RESCHEDULABLE.has(p.status);
                if (editingId === p.id) {
                  return (
                    <tr key={p.id}>
                      <td colSpan={9}>
                        <div className="flex flex-wrap items-end gap-2 py-1">
                          <div>
                            <label className="text-xs text-muted block mb-0.5">Planned date</label>
                            <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                              className="border border-border rounded-sm px-1.5 py-0.5 text-xs" />
                          </div>
                          <div>
                            <label className="text-xs text-muted block mb-0.5">Assigned to</label>
                            <select value={editAssignee} onChange={(e) => setEditAssignee(e.target.value)}
                              className="border border-border rounded-sm px-1.5 py-0.5 text-xs">
                              <option value="">Unassigned</option>
                              {employees.map((e) => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                              ))}
                            </select>
                          </div>
                          <button disabled={busy} onClick={() => saveEdit(p.id)}
                            className="text-xs text-good hover:underline disabled:opacity-50">Save</button>
                          <button onClick={cancelEdit} className="text-xs text-muted hover:underline">Cancel</button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={p.id}>
                    <td>
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={() => toggle(p.id)}
                          aria-label={`Select ${p.machine_number || p.id}`}
                        />
                      )}
                    </td>
                    <td>
                      <Link href={`/machines/${p.machine_id}`} className="text-accent hover:underline">
                        {p.machine_number} — {p.machine_name}
                      </Link>
                      {p.critical && <span className="status-pill bg-red-50 text-bad ml-1">CRITICAL</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {p.planned_date ? fmtDate(p.planned_date) : p.planned_week ? `Week ${p.planned_week}` : "—"}
                      {p.days_overdue > 0 && <span className="text-xs text-bad ml-1">{p.days_overdue} d late</span>}
                    </td>
                    <td className="whitespace-nowrap">
                      {p.actual_date ? fmtDate(p.actual_date) : "—"}
                      {p.completion_class && <span className="text-xs text-muted ml-1">{label(p.completion_class)}</span>}
                    </td>
                    <td>{p.assigned_to_name || "—"}</td>
                    <td>{p.completed_by_name || "—"}</td>
                    <td>{p.file_count || "—"}</td>
                    <td><StatusPill status={p.effective_status} /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        {p.status !== "COMPLETED" && p.status !== "CANCELLED" && (
                          <Link href={`/pm/${p.id}/complete`} className="text-xs text-accent hover:underline">
                            Complete
                          </Link>
                        )}
                        <Link href={`/pm/${p.id}`} className="text-xs text-accent hover:underline">
                          Details
                        </Link>
                        {reschedulable && (
                          <button onClick={() => startEdit(p)} className="text-xs text-muted hover:underline">
                            Reschedule
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size}
        onPage={(p) => setFilters((f) => ({ ...f, page: p }))} onPageSize={(n) => setFilters((f) => ({ ...f, page_size: n, page: 1 }))} />}
    </div>
  );
}
