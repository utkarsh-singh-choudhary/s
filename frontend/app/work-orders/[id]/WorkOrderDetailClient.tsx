"use client";

import { useState } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { api, ConsumedPart, Employee, Machine, SparePart, WorkOrder, WORK_ORDER_STATUSES, WORK_ORDER_PRIORITIES } from "@/lib/api";

type Why = { question: string; answer: string };

export default function WorkOrderDetailClient({
  initialWorkOrder,
  machines,
  employees,
  spareParts,
  initialConsumedParts,
}: {
  initialWorkOrder: WorkOrder;
  machines: Machine[];
  employees: Employee[];
  spareParts: SparePart[];
  initialConsumedParts: ConsumedPart[];
}) {
  const [wo, setWo] = useState(initialWorkOrder);
  const [consumedParts, setConsumedParts] = useState(initialConsumedParts);
  const [consumePartId, setConsumePartId] = useState(spareParts[0]?.id || "");
  const [consumeQty, setConsumeQty] = useState("1");
  const [consumeReason, setConsumeReason] = useState("");
  const [consumeError, setConsumeError] = useState<string | null>(null);
  const [consuming, setConsuming] = useState(false);
  const [status, setStatus] = useState(wo.status);
  const [rootCause, setRootCause] = useState(wo.root_cause || "");
  const [fiveWhys, setFiveWhys] = useState<Why[]>(
    wo.five_whys && wo.five_whys.length > 0 ? wo.five_whys : [{ question: "Why did the machine stop / the problem occur?", answer: "" }]
  );
  const [actionTaken, setActionTaken] = useState(wo.action_taken || "");
  const [partsUsed, setPartsUsed] = useState(wo.parts_used || "");
  const [laborHours, setLaborHours] = useState(wo.labor_hours != null ? String(wo.labor_hours) : "");
  const [downtime, setDowntime] = useState(wo.downtime_minutes != null ? String(wo.downtime_minutes) : "");
  const [assignTo, setAssignTo] = useState(wo.assigned_to || "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailTitle, setDetailTitle] = useState(wo.title);
  const [detailDescription, setDetailDescription] = useState(wo.description || "");
  const [detailPriority, setDetailPriority] = useState<string>(wo.priority);
  const [detailDueDate, setDetailDueDate] = useState(wo.due_date || "");

  const machine = machines.find((m) => m.id === wo.machine_id);

  const me = getUser();
  const isPrivileged = me?.role === "SUPERVISOR" || me?.role === "MANAGER" || me?.role === "ADMIN";
  const canEditDetails = wo.status !== "CLOSED" && (isPrivileged || (!!me?.employee_id && wo.reported_by === me.employee_id));

  function startEditDetails() {
    setDetailTitle(wo.title);
    setDetailDescription(wo.description || "");
    setDetailPriority(wo.priority);
    setDetailDueDate(wo.due_date || "");
    setError(null);
    setEditingDetails(true);
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!detailTitle.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.updateWorkOrder(wo.id, {
        title: detailTitle.trim(),
        description: detailDescription,
        priority: detailPriority,
        due_date: detailDueDate || null,
      });
      setWo(updated);
      setEditingDetails(false);
    } catch (err: any) {
      setError(err.message || "Failed to update work order details");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveStatus(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await api.updateWorkOrderStatus(wo.id, {
        status,
        root_cause: rootCause || undefined,
        five_whys: fiveWhys.some((w) => w.answer.trim()) ? fiveWhys.filter((w) => w.question.trim() || w.answer.trim()) : undefined,
        action_taken: actionTaken || undefined,
        parts_used: partsUsed || undefined,
        labor_hours: laborHours ? Number(laborHours) : undefined,
        downtime_minutes: downtime ? Number(downtime) : undefined,
      });
      setWo(updated);
      setSaved(true);
    } catch (err: any) {
      setError(err.message || "Failed to update work order");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveAssignment() {
    if (!assignTo) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.assignWorkOrder(wo.id, assignTo);
      setWo(updated);
      setStatus(updated.status);
    } catch (err: any) {
      setError(err.message || "Failed to assign work order");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitConsume(e: React.FormEvent) {
    e.preventDefault();
    if (!consumePartId || !consumeQty) return;
    setConsuming(true);
    setConsumeError(null);
    try {
      const updated = await api.consumePart(wo.id, {
        spare_part_id: consumePartId,
        quantity: Number(consumeQty),
        reason: consumeReason || undefined,
      });
      setWo(updated);
      setConsumedParts(await api.workOrderParts(wo.id));
      setConsumeQty("1");
      setConsumeReason("");
    } catch (err: any) {
      setConsumeError(err.message || "Failed to consume part");
    } finally {
      setConsuming(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <Link href="/work-orders" className="text-xs text-accent hover:underline">← Work orders</Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-lg font-semibold text-ink">{wo.display_number} — {wo.title}</h1>
          <span className="status-pill bg-gray-100 text-muted">{wo.priority}</span>
          {canEditDetails && !editingDetails && (
            <button onClick={startEditDetails} className="text-xs text-accent hover:underline">
              Edit details
            </button>
          )}
        </div>
        <p className="text-sm text-muted">
          {machine ? (
            <Link href={`/machines/${machine.id}`} className="text-accent hover:underline">
              {machine.machine_number} — {machine.machine_name}
            </Link>
          ) : (
            wo.machine_id
          )}
        </p>
      </div>

      {editingDetails ? (
        <form onSubmit={saveDetails} className="kpi-card space-y-3">
          <div className="font-medium text-sm">Edit details</div>
          {error && <div className="text-xs text-bad bg-red-50 border border-red-100 rounded-sm px-3 py-2">{error}</div>}
          <div>
            <label className="text-xs text-muted block mb-1">Title</label>
            <input value={detailTitle} onChange={(e) => setDetailTitle(e.target.value)} required className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Description</label>
            <textarea value={detailDescription} onChange={(e) => setDetailDescription(e.target.value)} rows={3} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Priority</label>
              <select value={detailPriority} onChange={(e) => setDetailPriority(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm">
                {WORK_ORDER_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Due date</label>
              <input type="date" value={detailDueDate} onChange={(e) => setDetailDueDate(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
              {submitting ? "Saving…" : "Save details"}
            </button>
            <button type="button" onClick={() => setEditingDetails(false)} className="text-sm px-3 py-1.5 rounded-sm border border-border">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        wo.description && (
          <div className="kpi-card text-sm">
            <div className="text-xs text-muted uppercase tracking-wide mb-1">Description</div>
            {wo.description}
          </div>
        )
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Meta label="Status" value={wo.status.replace(/_/g, " ")} />
        <Meta label="Reported by" value={wo.reported_by_name || "—"} />
        <Meta label="Assigned to" value={wo.assigned_to_name || "Unassigned"} />
        <Meta label="Due date" value={wo.due_date || "—"} />
      </div>

      {employees.length > 0 && (
        <div className="kpi-card space-y-2">
          <div className="font-medium text-sm">Reassign</div>
          <div className="flex gap-2">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm flex-1">
              <option value="">Select employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name} ({e.role})</option>
              ))}
            </select>
            <button onClick={saveAssignment} disabled={submitting || !assignTo} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
              Assign
            </button>
          </div>
        </div>
      )}

      <div className="kpi-card space-y-3">
        <div className="font-medium text-sm">Parts consumed</div>
        {consumeError && <div className="text-xs text-bad bg-red-50 border border-red-100 rounded-sm px-3 py-2">{consumeError}</div>}
        {consumedParts.length === 0 ? (
          <p className="text-xs text-muted">No parts logged against this work order yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {consumedParts.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span>{p.part_code} — {p.part_name}</span>
                <span className="text-muted">x{p.quantity}</span>
              </li>
            ))}
          </ul>
        )}
        {spareParts.length > 0 ? (
          <form onSubmit={submitConsume} className="flex flex-wrap items-end gap-2 pt-2 border-t border-border">
            <div>
              <label className="text-xs text-muted block mb-1">Part</label>
              <select value={consumePartId} onChange={(e) => setConsumePartId(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
                {spareParts.map((p) => (
                  <option key={p.id} value={p.id}>{p.part_code} — {p.name} ({p.stock_on_hand} {p.unit} in stock)</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Qty</label>
              <input type="number" min={1} value={consumeQty} onChange={(e) => setConsumeQty(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm w-16" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Reason (optional)</label>
              <input value={consumeReason} onChange={(e) => setConsumeReason(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm w-40" />
            </div>
            <button type="submit" disabled={consuming} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
              {consuming ? "Logging…" : "Consume"}
            </button>
          </form>
        ) : (
          <p className="text-xs text-muted pt-2 border-t border-border">No spare parts in inventory yet — add some on the Spare Parts page.</p>
        )}
      </div>

      <form onSubmit={saveStatus} className="kpi-card space-y-3">
        <div className="font-medium text-sm">Update work order</div>
        {error && <div className="text-xs text-bad bg-red-50 border border-red-100 rounded-sm px-3 py-2">{error}</div>}
        {saved && <div className="text-xs text-good">Saved.</div>}

        <div>
          <label className="text-xs text-muted block mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as WorkOrder["status"])} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm">
            {WORK_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-muted block mb-1">Root cause (summary)</label>
          <textarea value={rootCause} onChange={(e) => setRootCause(e.target.value)} rows={2} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
        </div>

        <div className="border border-border rounded-sm p-3 space-y-2">
          <div className="text-xs font-medium text-muted uppercase tracking-wide">5 Whys (root-cause chain)</div>
          {fiveWhys.map((why, i) => (
            <div key={i} className="space-y-1">
              <input
                value={why.question}
                onChange={(e) => {
                  const next = [...fiveWhys];
                  next[i] = { ...next[i], question: e.target.value };
                  setFiveWhys(next);
                }}
                placeholder={`Why #${i + 1}`}
                className="w-full border border-border rounded-sm px-2 py-1 text-xs font-medium"
              />
              <input
                value={why.answer}
                onChange={(e) => {
                  const next = [...fiveWhys];
                  next[i] = { ...next[i], answer: e.target.value };
                  setFiveWhys(next);
                }}
                placeholder="Answer"
                className="w-full border border-border rounded-sm px-2 py-1 text-xs ml-4"
                style={{ width: "calc(100% - 1rem)" }}
              />
            </div>
          ))}
          <div className="flex gap-3">
            {fiveWhys.length < 5 && (
              <button
                type="button"
                onClick={() => setFiveWhys([...fiveWhys, { question: `Why #${fiveWhys.length + 1}`, answer: "" }])}
                className="text-xs text-accent hover:underline"
              >
                + Add another why
              </button>
            )}
            {fiveWhys.length > 1 && (
              <button
                type="button"
                onClick={() => setFiveWhys(fiveWhys.slice(0, -1))}
                className="text-xs text-muted hover:underline"
              >
                Remove last
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="text-xs text-muted block mb-1">Action taken</label>
          <textarea value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} rows={2} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
        </div>

        <div>
          <label className="text-xs text-muted block mb-1">Parts used</label>
          <input value={partsUsed} onChange={(e) => setPartsUsed(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" placeholder="e.g. Bearing 6205 x2" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted block mb-1">Labor hours</label>
            <input type="number" min={0} value={laborHours} onChange={(e) => setLaborHours(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Downtime (minutes)</label>
            <input type="number" min={0} value={downtime} onChange={(e) => setDowntime(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
          </div>
        </div>

        <button type="submit" disabled={submitting} className="bg-ink text-white text-sm rounded-sm py-2 px-4 hover:opacity-90 disabled:opacity-50">
          {submitting ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-card !p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
