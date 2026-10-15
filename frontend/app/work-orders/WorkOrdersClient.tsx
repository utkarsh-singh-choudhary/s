"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import {
  api, DirectoryPerson, FAILURE_CATEGORIES, Machine, Paged, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES,
  WorkOrderRow, WorkOrderSummary,
} from "@/lib/api";
import { defaultFilters, FilterBar, filterParams, FilterState } from "@/components/FilterBar";
import { Pagination } from "@/components/Pagination";
import { Pill } from "@/components/Pill";
import { KpiCard } from "@/components/KpiCard";
import { DateField } from "@/components/DateField";
import { fmtDate, fmtMoney, label } from "@/lib/format";

const SOURCES = ["BREAKDOWN", "PM", "INSPECTION", "OPERATOR_REQUEST", "IMPROVEMENT"];

export default function WorkOrdersClient({
  machines, people, initialMachineId, initialStatus, initialPriority,
}: { machines: Machine[]; people: DirectoryPerson[]; initialMachineId: string; initialStatus: string; initialPriority: string }) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters({ date_basis: "created" }));
  const [status, setStatus] = useState(initialStatus);
  const [priority, setPriority] = useState(initialPriority);
  const [source, setSource] = useState("");
  const [machineId, setMachineId] = useState(initialMachineId);
  const [assignedTo, setAssignedTo] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [data, setData] = useState<Paged<WorkOrderRow, WorkOrderSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | undefined>();
  const [showForm, setShowForm] = useState(false);

  const extra = { status, priority, source, machine_id: machineId, assigned_to: assignedTo, overdue_only: overdueOnly };
  const params = { ...filterParams(filters), ...extra };
  useEffect(() => setRole(getUser()?.role), []);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.searchWorkOrders(params)); setError(null); }
    catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);
  useEffect(() => { load(); }, [load]);

  const reset = (fn: () => void) => { fn(); setFilters((f) => ({ ...f, page: 1 })); };
  const canExport = role === "ADMIN" || role === "MANAGER" || role === "SUPERVISOR";
  const s = data?.summary;
  const sel = "border border-border rounded-sm px-2 py-1.5 text-sm";

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-ink">Work Orders</h1>
          <p className="text-sm text-muted">Repair, inspection and improvement jobs — from request to verified close.</p>
        </div>
        {role && role !== "VIEWER" && (
          <button onClick={() => setShowForm((v) => !v)} className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90">
            {showForm ? "Cancel" : "New work order"}
          </button>
        )}
      </div>

      {showForm && <CreateForm machines={machines} people={people} role={role} defaultMachine={machineId} onDone={(id) => { window.location.href = `/work-orders/${id}`; }} />}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Matching" value={s?.total ?? "—"} />
        <KpiCard label="Open" value={s?.open ?? "—"} />
        <KpiCard label="Overdue" value={s?.overdue ?? "—"} tone={s && s.overdue > 0 ? "bad" : undefined} />
        <KpiCard label="Completed" value={s?.completed ?? "—"} />
        <KpiCard label="Downtime" value={s ? `${s.downtime_hours} h` : "—"} />
      </div>

      <FilterBar
        value={filters} onChange={setFilters}
        basisOptions={[{ value: "created", label: "Created date" }, { value: "completed", label: "Completed date" }, { value: "due", label: "Due date" }]}
        sortOptions={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "priority", label: "Priority" }, { value: "due", label: "Due date" }, { value: "machine", label: "Machine" }]}
        canExport={canExport}
        onExport={(fmt) => api.exportWorkOrders({ ...filterParams(filters), ...extra, page: undefined, page_size: undefined }, fmt)}
        rangeLabel={data?.range}
      >
        <div><label className="text-xs text-muted block mb-1">Status</label>
          <select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className={sel}>
            <option value="">All</option>{WORK_ORDER_STATUSES.map((x) => <option key={x} value={x}>{label(x)}</option>)}
          </select></div>
        <div><label className="text-xs text-muted block mb-1">Priority</label>
          <select value={priority} onChange={(e) => reset(() => setPriority(e.target.value))} className={sel}>
            <option value="">All</option>{WORK_ORDER_PRIORITIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></div>
        <div><label className="text-xs text-muted block mb-1">Source</label>
          <select value={source} onChange={(e) => reset(() => setSource(e.target.value))} className={sel}>
            <option value="">All</option>{SOURCES.map((x) => <option key={x} value={x}>{label(x)}</option>)}
          </select></div>
        <div><label className="text-xs text-muted block mb-1">Machine</label>
          <select value={machineId} onChange={(e) => reset(() => setMachineId(e.target.value))} className={`${sel} max-w-[160px]`}>
            <option value="">All</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number}</option>)}
          </select></div>
        <div><label className="text-xs text-muted block mb-1">Assigned to</label>
          <select value={assignedTo} onChange={(e) => reset(() => setAssignedTo(e.target.value))} className={`${sel} max-w-[160px]`}>
            <option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <label className="text-sm flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={overdueOnly} onChange={(e) => reset(() => setOverdueOnly(e.target.checked))} /> Overdue</label>
      </FilterBar>

      {error && <div className="text-sm text-bad">{error}</div>}

      <div className={`kpi-card !p-0 overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        {data && data.items.length === 0 ? <div className="px-4 py-6 text-sm text-muted">No work orders match these filters.</div> : (
          <table className="data-table">
            <thead><tr><th>WO #</th><th>Machine</th><th>Title</th><th>Source</th><th>Priority</th><th>Assigned</th><th>Created</th><th>Due</th><th>Cost</th><th>Status</th></tr></thead>
            <tbody>
              {(data?.items || []).map((w) => (
                <tr key={w.id}>
                  <td className="font-mono text-xs"><Link href={`/work-orders/${w.id}`} className="text-accent hover:underline">{w.display_number}</Link></td>
                  <td>{w.machine_number}</td>
                  <td>{w.title}{w.reopen_count ? <span className="text-xs text-muted"> · reopened ×{w.reopen_count}</span> : null}</td>
                  <td className="text-xs">{label(w.source)}</td>
                  <td><Pill value={w.priority} /></td>
                  <td>{w.assigned_to_name || "—"}</td>
                  <td className="whitespace-nowrap">{fmtDate(w.created_at)}</td>
                  <td className={`whitespace-nowrap ${w.overdue ? "text-bad font-medium" : ""}`}>{fmtDate(w.due_date)}</td>
                  <td className="whitespace-nowrap">{w.actual_cost != null ? fmtMoney(w.actual_cost) : "—"}</td>
                  <td>{w.cancelled ? <Pill value="CANCELLED" /> : <Pill value={w.status} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size}
        onPage={(p) => setFilters((f) => ({ ...f, page: p }))} onPageSize={(n) => setFilters((f) => ({ ...f, page_size: n, page: 1 }))} />}
    </div>
  );
}

function CreateForm({ machines, people, role, defaultMachine, onDone }: {
  machines: Machine[]; people: DirectoryPerson[]; role?: string; defaultMachine: string; onDone: (id: string) => void;
}) {
  const [machineId, setMachineId] = useState(defaultMachine || machines[0]?.id || "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [source, setSource] = useState("OPERATOR_REQUEST");
  const [category, setCategory] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [due, setDue] = useState("");
  const [risk, setRisk] = useState("");
  const [loto, setLoto] = useState(false);
  const [permit, setPermit] = useState(false);
  const [estH, setEstH] = useState("");
  const [estC, setEstC] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditor = role === "SUPERVISOR" || role === "MANAGER" || role === "ADMIN";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const wo = await api.createWorkOrderFull({
        machine_id: machineId, title: title.trim(), description: description.trim() || undefined, priority, source,
        failure_category: category || undefined, assigned_to: assignedTo || undefined, due_date: due || undefined,
        safety_risk: risk || undefined, loto_required: loto, permit_required: permit,
        estimated_hours: estH ? Number(estH) : undefined, estimated_cost: estC ? Number(estC) : undefined,
      });
      onDone(wo.id);
    } catch (err: any) { setError(err.message); }
    finally { setBusy(false); }
  }

  const inp = "w-full border border-border rounded-sm px-2 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="kpi-card space-y-3 max-w-3xl">
      <div className="font-medium text-sm">New work order</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="text-xs text-muted block mb-1">Machine *</label>
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className={inp} required>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number} — {m.machine_name}</option>)}</select></div>
        <div><label className="text-xs text-muted block mb-1">Title *</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className={inp} placeholder="e.g. Replace main bearing" /></div>
        <div><label className="text-xs text-muted block mb-1">Source</label>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={inp}>{SOURCES.filter((s) => s !== "BREAKDOWN").map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
        <div><label className="text-xs text-muted block mb-1">Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inp}>{WORK_ORDER_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div><label className="text-xs text-muted block mb-1">Failure category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inp}><option value="">—</option>{FAILURE_CATEGORIES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div><label className="text-xs text-muted block mb-1">Due date</label><DateField value={due} onChange={setDue} className="!w-full" /></div>
        <div><label className="text-xs text-muted block mb-1">Assign to</label>
          <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={inp}>
            <option value="">{isEditor ? "Unassigned" : "Me / unassigned"}</option>
            {people.filter((p) => isEditor || false).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}</select></div>
        {isEditor && (
          <>
            <div><label className="text-xs text-muted block mb-1">Safety risk</label>
              <select value={risk} onChange={(e) => setRisk(e.target.value)} className={inp}><option value="">—</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></div>
            <div><label className="text-xs text-muted block mb-1">Estimated hours</label><input type="number" min="0" step="0.5" value={estH} onChange={(e) => setEstH(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-muted block mb-1">Estimated cost</label><input type="number" min="0" value={estC} onChange={(e) => setEstC(e.target.value)} className={inp} /></div>
            <div className="flex items-center gap-4 pt-5 text-sm">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={loto} onChange={(e) => setLoto(e.target.checked)} /> Lock-out / tag-out</label>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={permit} onChange={(e) => setPermit(e.target.checked)} /> Work permit</label>
            </div>
          </>
        )}
      </div>
      <div><label className="text-xs text-muted block mb-1">Description</label><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={inp} /></div>
      {error && <div className="text-sm text-bad">{error}</div>}
      <button type="submit" disabled={busy || !title.trim()} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">{busy ? "Creating…" : "Create work order"}</button>
    </form>
  );
}
