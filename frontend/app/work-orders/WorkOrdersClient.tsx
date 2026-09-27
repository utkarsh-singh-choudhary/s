"use client";

import { useState } from "react";
import Link from "next/link";
import { api, Employee, Machine, WorkOrder, WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES } from "@/lib/api";

const STATUS_TONE: Record<string, string> = {
  OPEN: "bg-blue-50 text-blue-700",
  ASSIGNED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-amber-50 text-amber-800",
  WAITING_PARTS: "bg-amber-50 text-amber-800",
  WAITING_APPROVAL: "bg-amber-50 text-amber-800",
  COMPLETED: "bg-green-50 text-good",
  VERIFIED: "bg-green-50 text-good",
  CLOSED: "bg-gray-100 text-muted",
};

export default function WorkOrdersClient({
  initialWorkOrders,
  machines,
  employees,
  machineFilterId,
}: {
  initialWorkOrders: WorkOrder[];
  machines: Machine[];
  employees: Employee[];
  machineFilterId?: string;
}) {
  const [workOrders, setWorkOrders] = useState(initialWorkOrders);
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [machineId, setMachineId] = useState(machineFilterId || machines[0]?.id || "");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<string>("MEDIUM");
  const [assignedTo, setAssignedTo] = useState("");
  const [dueDate, setDueDate] = useState("");

  const machineById = new Map(machines.map((m) => [m.id, m]));
  const filtered = statusFilter ? workOrders.filter((w) => w.status === statusFilter) : workOrders;
  const openCount = workOrders.filter((w) => !["CLOSED", "VERIFIED"].includes(w.status)).length;

  async function refresh() {
    try {
      setWorkOrders(await api.workOrders(machineFilterId ? { machine_id: machineFilterId } : {}));
    } catch {
      // keep existing list
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!machineId || !title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createWorkOrder({
        machine_id: machineId,
        title: title.trim(),
        priority,
        assigned_to: assignedTo || undefined,
        due_date: dueDate || undefined,
      });
      setTitle("");
      setAssignedTo("");
      setDueDate("");
      setShowForm(false);
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to create work order");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Work Orders</h1>
          <p className="text-sm text-muted">
            {workOrders.length} total, {openCount} open.
            {machineFilterId && (
              <>
                {" "}— filtered to {machineById.get(machineFilterId)?.machine_number || "this machine"}.{" "}
                <Link href="/work-orders" className="text-accent hover:underline">Clear</Link>
              </>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90"
        >
          {showForm ? "Cancel" : "New work order"}
        </button>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {showForm && (
        <form onSubmit={submitCreate} className="kpi-card space-y-3 max-w-lg">
          <div className="font-medium text-sm">New work order</div>
          <div>
            <label className="text-xs text-muted block mb-1">Machine</label>
            <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm">
              {machines.map((m) => (
                <option key={m.id} value={m.id}>{m.machine_number} — {m.machine_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" placeholder="e.g. Bearing replacement" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm">
                {WORK_ORDER_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
            </div>
          </div>
          {employees.length > 0 && (
            <div>
              <label className="text-xs text-muted block mb-1">Assign to (optional)</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm">
                <option value="">Unassigned</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.role})</option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" disabled={submitting} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
            {submitting ? "Creating…" : "Create work order"}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <FilterChip label="All" active={!statusFilter} onClick={() => setStatusFilter("")} />
        {WORK_ORDER_STATUSES.map((s) => (
          <FilterChip key={s} label={s.replace(/_/g, " ")} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
        ))}
      </div>

      <div className="kpi-card !p-0 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No work orders match this filter.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>WO #</th>
                <th>Machine</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Assigned</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((w) => {
                const machine = machineById.get(w.machine_id);
                return (
                  <tr key={w.id}>
                    <td className="font-mono text-xs">
                      <Link href={`/work-orders/${w.id}`} className="text-accent hover:underline">{w.display_number}</Link>
                    </td>
                    <td>{machine ? machine.machine_number : w.machine_id.slice(0, 8)}</td>
                    <td>{w.title}</td>
                    <td>
                      <span className={`status-pill ${w.priority === "CRITICAL" || w.priority === "HIGH" ? "bg-red-50 text-bad" : "bg-gray-100 text-muted"}`}>
                        {w.priority}
                      </span>
                    </td>
                    <td>{w.assigned_to_name || "—"}</td>
                    <td>{w.due_date || "—"}</td>
                    <td>
                      <span className={`status-pill ${STATUS_TONE[w.status] || "bg-gray-100 text-muted"}`}>{w.status.replace(/_/g, " ")}</span>
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

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-sm border ${
        active ? "bg-ink text-white border-ink" : "bg-panel text-muted border-border hover:bg-surface"
      }`}
    >
      {label}
    </button>
  );
}
