"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import {
  api, ChecklistAnswer, DirectoryPerson, FAILURE_CATEGORIES, SparePart, WorkOrderDetail,
} from "@/lib/api";
import { Pill } from "@/components/Pill";
import { EvidencePanel } from "@/components/EvidencePanel";
import { DateField } from "@/components/DateField";
import {
  fmtDate, fmtDateTime, fmtMinutes, fmtMoney, label, localInputToApi, nowLocalInput,
} from "@/lib/format";

const WAIT_OTHER = ["APPROVAL", "ACCESS", "VENDOR", "SHUTDOWN"];
const inp = "w-full border border-border rounded-sm px-2 py-1.5 text-sm disabled:bg-surface";

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

export default function WorkOrderDetailClient({ id }: { id: string }) {
  const [d, setD] = useState<WorkOrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [me, setMe] = useState<string | undefined>();
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [parts, setParts] = useState<SparePart[]>([]);

  const load = useCallback(async () => {
    try { setD(await api.workOrderDetail(id)); setError(null); }
    catch (e: any) { setError(e.message); }
  }, [id]);

  useEffect(() => {
    const u = getUser();
    setRole(u?.role); setMe(u?.employee_id);
    load();
    api.directory().then(setPeople).catch(() => {});
    api.searchSpareParts({}).then(setParts).catch(() => {});
  }, [load]);

  if (error) return <div className="p-6 space-y-2"><p className="text-sm text-bad">{error}</p><Link href="/work-orders" className="text-sm text-accent hover:underline">← Work orders</Link></div>;
  if (!d) return <div className="p-6 text-sm text-muted">Loading…</div>;

  const wo = d.work_order;
  const isEditor = role === "SUPERVISOR" || role === "MANAGER" || role === "ADMIN";
  const isManager = role === "MANAGER" || role === "ADMIN";
  const canWork = !!role && role !== "VIEWER" && (isEditor || !wo.assigned_to || wo.assigned_to === me);
  const locked = wo.cancelled || wo.status === "VERIFIED" || wo.status === "CLOSED";
  const working = ["IN_PROGRESS", "WAITING_PARTS", "WAITING_APPROVAL"].includes(wo.status);
  const c = d.cost_summary;

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link href="/work-orders" className="text-xs text-accent hover:underline">← Work orders</Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-lg font-semibold text-ink"><span className="font-mono">{wo.display_number}</span> {wo.title}</h1>
          {wo.cancelled ? <Pill value="CANCELLED" /> : <Pill value={wo.status} />}
          <Pill value={wo.priority} />
          {wo.status === "WAITING_PARTS" || wo.status === "WAITING_APPROVAL" ? <span className="text-xs text-muted">waiting: {label(wo.waiting_reason)}</span> : null}
          {d.requires_verification && <span className="status-pill bg-blue-50 text-blue-700" title="Critical / safety job: a second person must verify it">needs verification</span>}
          {!!wo.reopen_count && <span className="status-pill bg-amber-50 text-amber-800">reopened ×{wo.reopen_count}</span>}
        </div>
        <p className="text-sm text-muted">
          {d.machine && <Link href={`/machines/${d.machine.id}`} className="text-accent hover:underline">{d.machine.machine_number} {d.machine.machine_name}</Link>}
          {d.machine?.critical ? " ★ critical" : ""} · {label(wo.source)}
          {d.breakdown && <> · <Link href={`/breakdowns/${d.breakdown.id}`} className="text-accent hover:underline">{d.breakdown.bd_number}</Link></>}
          {wo.pm_plan_id && <> · <Link href={`/pm/${wo.pm_plan_id}`} className="text-accent hover:underline">from PM</Link></>}
          {d.parent_work_order_id && <> · <Link href={`/work-orders/${d.parent_work_order_id}`} className="text-accent hover:underline">parent job</Link></>}
        </p>
      </div>

      {wo.cancelled && <div className="kpi-card text-sm">Cancelled: {wo.cancel_reason}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Info label="Assigned to" value={wo.assigned_to_name || "Unassigned"} />
        <Info label="Due" value={fmtDate(wo.due_date)} />
        <Info label="Started" value={fmtDateTime(wo.started_at)} />
        <Info label={wo.completed_at ? "Completed" : "Machine restored"} value={fmtDateTime(wo.completed_at || wo.restored_at)} />
      </div>

      {!locked && canWork && <Actions d={d} people={people} isEditor={isEditor} isManager={isManager} onDone={load} />}
      {(wo.status === "VERIFIED" || wo.status === "CLOSED") && !wo.cancelled && (
        <div className="kpi-card text-sm flex items-center justify-between flex-wrap gap-3">
          <span>{wo.status === "VERIFIED" ? "Verified" : "Closed"}{wo.verified_by_name ? ` — verified by ${wo.verified_by_name}` : ""}{wo.closed_at ? `, closed ${fmtDateTime(wo.closed_at)}` : ""}. Locked.</span>
          {isManager && <ReasonButton text="Reopen…" action="Reopen" onSubmit={(r) => api.reopenWorkOrder(wo.id, r)} onDone={load} />}
        </div>
      )}
      {wo.status === "COMPLETED" && isManager && <div className="text-sm"><ReasonButton text="Reopen…" action="Reopen" onSubmit={(r) => api.reopenWorkOrder(wo.id, r)} onDone={load} /></div>}

      <Safety d={d} canEdit={!locked && canWork} onDone={load} />
      <Planning d={d} canEdit={!locked && isEditor} onDone={load} />
      <Checklist d={d} canEdit={!locked && canWork && (working || wo.status === "COMPLETED")} onDone={load} />
      <Labour d={d} people={people} isEditor={isEditor} canEdit={!locked && canWork} meId={me} onDone={load} />
      <Parts d={d} parts={parts} canEdit={!locked && canWork && wo.status !== "OPEN" && wo.status !== "ASSIGNED"} onDone={load} />
      <Costs d={d} canEdit={!locked && canWork} isEditor={isEditor} isManager={isManager} onDone={load} />

      <div className="kpi-card">
        <div className="font-medium text-sm mb-2">Cost summary</div>
        <dl className="grid grid-cols-2 sm:grid-cols-6 gap-3 text-sm">
          <Mini label="Parts" v={fmtMoney(c.parts, c.currency)} />
          <Mini label={`Labour (${c.labour_hours} h)`} v={fmtMoney(c.labour, c.currency)} />
          <Mini label="External" v={fmtMoney(c.external_services, c.currency)} />
          <Mini label="Consumables + other" v={fmtMoney(c.consumables + c.other, c.currency)} />
          <Mini label="Actual total" v={fmtMoney(c.actual_total, c.currency)} bold />
          <Mini label="Estimated" v={c.estimated_total != null ? fmtMoney(c.estimated_total, c.currency) : "—"} />
        </dl>
        {c.pending_approval > 0 && <p className="text-xs text-warn mt-2">{fmtMoney(c.pending_approval, c.currency)} of costs are waiting for approval and are not counted yet.</p>}
      </div>

      <EvidencePanel kind="work_order" entityId={wo.id} files={d.evidence} canUpload={!locked && canWork} canDelete={isManager} onChanged={load} />

      {d.child_work_orders.length > 0 && (
        <div className="kpi-card text-sm space-y-1"><div className="font-medium">Follow-up work orders</div>
          {d.child_work_orders.map((x) => <div key={x.id}><Link href={`/work-orders/${x.id}`} className="text-accent hover:underline">{x.display_number}</Link> {x.title} <Pill value={x.status} /></div>)}</div>
      )}

      <div className="kpi-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border font-medium text-sm">History</div>
        <table className="data-table"><tbody>
          {[...d.logs].reverse().map((l) => (
            <tr key={l.id}>
              <td className="whitespace-nowrap text-xs">{fmtDateTime(l.at)}</td>
              <td className="text-xs">{label(l.event)}{l.to_status ? ` → ${label(l.to_status)}` : ""}</td>
              <td className="text-xs">{l.by_name || "—"}</td>
              <td className="text-xs text-muted">{[l.reason && label(l.reason), l.note].filter(Boolean).join(" — ")}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </div>
  );
}

function Info({ label: l, value }: { label: string; value: string }) {
  return <div className="kpi-card"><div className="kpi-label">{l}</div><div className="text-sm font-medium">{value}</div></div>;
}
function Mini({ label: l, v, bold }: { label: string; v: string; bold?: boolean }) {
  return <div><dt className="text-xs text-muted">{l}</dt><dd className={bold ? "font-semibold" : ""}>{v}</dd></div>;
}

function ReasonButton({ text, action, onSubmit, onDone }: { text: string; action: string; onSubmit: (reason: string) => Promise<any>; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-accent hover:underline">{text}</button>;
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="border border-border rounded-sm px-2 py-1 text-sm w-64" />
      <button className="text-sm px-2 py-1 bg-ink text-white rounded-sm" onClick={async () => { try { await onSubmit(reason); setOpen(false); setReason(""); onDone(); } catch (e: any) { setErr(e.message); } }}>{action}</button>
      <button className="text-sm text-muted" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="text-xs text-bad w-full">{err}</span>}
    </span>
  );
}

// -------------------------------------------------------------- lifecycle buttons

function Actions({ d, people, isEditor, isManager, onDone }: { d: WorkOrderDetail; people: DirectoryPerson[]; isEditor: boolean; isManager: boolean; onDone: () => void }) {
  const wo = d.work_order;
  const [mode, setMode] = useState<null | "pause" | "finish" | "back" | "assign">(null);
  const [waitType, setWaitType] = useState("WAITING_PARTS");
  const [waitReason, setWaitReason] = useState("APPROVAL");
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState(wo.assigned_to || "");
  const [err, setErr] = useState<{ text: string; list: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  // completion form
  const [summary, setSummary] = useState(wo.repair_summary || "");
  const [code, setCode] = useState(wo.resolution_code || "");
  const [diagnosis, setDiagnosis] = useState(wo.diagnosis || wo.root_cause || "");
  const [actionTaken, setActionTaken] = useState(wo.action_taken || "");
  const [downtime, setDowntime] = useState(wo.downtime_minutes != null ? String(wo.downtime_minutes) : "");
  const [restoreMachine, setRestoreMachine] = useState(!!d.breakdown);
  const [restoredAt, setRestoredAt] = useState(nowLocalInput());

  async function run(fn: () => Promise<any>) {
    setBusy(true); setErr(null);
    try { await fn(); setMode(null); setNote(""); onDone(); }
    catch (e: any) {
      const parts = String(e.message).split(" • ");
      setErr({ text: parts[0], list: parts.slice(1) });
    } finally { setBusy(false); }
  }

  const next = d.allowed_next_statuses;
  const st = wo.status;
  return (
    <div className="kpi-card space-y-3">
      <div className="font-medium text-sm">Actions</div>
      <div className="flex flex-wrap gap-2">
        {(st === "OPEN" || st === "ASSIGNED") && <Btn onClick={() => run(() => api.workOrderLog(wo.id, { event: "START" }))}>▶ Start work</Btn>}
        {st === "IN_PROGRESS" && <Btn onClick={() => setMode("pause")}>⏸ Pause (waiting)</Btn>}
        {(st === "WAITING_PARTS" || st === "WAITING_APPROVAL") && <Btn onClick={() => run(() => api.workOrderLog(wo.id, { event: "RESUME" }))}>▶ Resume</Btn>}
        {st === "IN_PROGRESS" && <Btn primary onClick={() => setMode("finish")}>✔ Finish work</Btn>}
        {st === "COMPLETED" && isEditor && next.includes("VERIFIED") && <Btn primary onClick={() => run(() => api.workOrderStatus(wo.id, { status: "VERIFIED" }))}>Verify</Btn>}
        {st === "COMPLETED" && isEditor && next.includes("CLOSED") && !d.requires_verification && <Btn onClick={() => run(() => api.workOrderStatus(wo.id, { status: "CLOSED" }))}>Close</Btn>}
        {st === "VERIFIED" && isEditor && <Btn primary onClick={() => run(() => api.workOrderStatus(wo.id, { status: "CLOSED" }))}>Close</Btn>}
        {st === "COMPLETED" && isEditor && <Btn onClick={() => setMode("back")}>↩ Send back</Btn>}
        {isEditor && <Btn onClick={() => setMode("assign")}>Assign…</Btn>}
        {isEditor && st !== "COMPLETED" && <ReasonButton text="Cancel work order…" action="Cancel it" onSubmit={(r) => api.cancelWorkOrder(wo.id, r)} onDone={onDone} />}
      </div>

      {mode === "pause" && (
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex gap-3 flex-wrap items-end">
            <div><label className="text-xs text-muted block mb-1">Waiting for</label>
              <select value={waitType} onChange={(e) => setWaitType(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
                <option value="WAITING_PARTS">Spare parts</option><option value="WAITING_APPROVAL">Approval / access / vendor / shutdown</option></select></div>
            {waitType === "WAITING_APPROVAL" && (
              <div><label className="text-xs text-muted block mb-1">Reason</label>
                <select value={waitReason} onChange={(e) => setWaitReason(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
                  {WAIT_OTHER.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
            )}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="border border-border rounded-sm px-2 py-1.5 text-sm flex-1 min-w-[180px]" />
            <Btn primary disabled={busy} onClick={() => run(() => api.workOrderStatus(wo.id, { status: waitType, reason: waitType === "WAITING_PARTS" ? "PARTS" : waitReason, note: note || undefined }))}>Pause</Btn>
          </div>
        </div>
      )}

      {mode === "back" && (
        <div className="border-t border-border pt-3 flex gap-2 flex-wrap">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is it being sent back?" className="border border-border rounded-sm px-2 py-1.5 text-sm flex-1 min-w-[220px]" />
          <Btn primary disabled={busy || !note.trim()} onClick={() => run(() => api.workOrderStatus(wo.id, { status: "IN_PROGRESS", reason: note }))}>Send back</Btn>
        </div>
      )}

      {mode === "assign" && (
        <div className="border-t border-border pt-3 flex gap-2 flex-wrap items-end">
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
            <option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}</select>
          <Btn primary disabled={busy || !assignee} onClick={() => run(() => api.assignWorkOrder(wo.id, assignee))}>Assign</Btn>
        </div>
      )}

      {mode === "finish" && (
        <div className="border-t border-border pt-3 space-y-3">
          <p className="text-xs text-muted">Everything below must be filled in (and any checklist and labour recorded) before the job can be completed.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className="text-xs text-muted block mb-1">Repair summary *</label><textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-muted block mb-1">Resolution *</label>
              <select value={code} onChange={(e) => setCode(e.target.value)} className={inp}><option value="">Choose…</option>{d.resolution_codes.map((r) => <option key={r} value={r}>{label(r)}</option>)}</select></div>
            <div><label className="text-xs text-muted block mb-1">Downtime (minutes) *</label><input type="number" min="0" value={downtime} onChange={(e) => setDowntime(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-muted block mb-1">Diagnosis *</label><textarea rows={2} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} className={inp} /></div>
            <div><label className="text-xs text-muted block mb-1">Action taken *</label><textarea rows={2} value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} className={inp} /></div>
          </div>
          {d.breakdown && (
            <div className="flex items-center gap-3 flex-wrap text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={restoreMachine} onChange={(e) => setRestoreMachine(e.target.checked)} /> The machine is running again</label>
              {restoreMachine && <input type="datetime-local" value={restoredAt} max={nowLocalInput()} onChange={(e) => setRestoredAt(e.target.value)} className="border border-border rounded-sm px-2 py-1 text-sm" />}
            </div>
          )}
          {d.completion_blockers.length > 0 && (
            <div className="text-xs text-warn"><b>Still missing:</b> {d.completion_blockers.join(" • ")}</div>
          )}
          <Btn primary disabled={busy} onClick={() => run(async () => {
            await api.updateWorkOrderFields(wo.id, {
              repair_summary: summary, resolution_code: code || undefined, diagnosis, action_taken: actionTaken,
              downtime_minutes: downtime === "" ? undefined : Number(downtime),
            });
            await api.workOrderStatus(wo.id, {
              status: "COMPLETED", restore_machine: restoreMachine && !!d.breakdown,
              restored_at: restoreMachine && d.breakdown ? localInputToApi(restoredAt) : undefined,
            });
          })}>Complete work order</Btn>
        </div>
      )}
      {err && (
        <div className="text-sm text-bad space-y-1">
          <div>{err.text}</div>
          {err.list.length > 0 && <ul className="list-disc ml-5 text-xs">{err.list.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

function Btn({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return <button onClick={onClick} disabled={disabled} className={`text-sm px-3 py-1.5 rounded-sm border disabled:opacity-50 ${primary ? "bg-accent text-white border-accent" : "border-border hover:bg-surface"}`}>{children}</button>;
}

// -------------------------------------------------------------- safety

function Safety({ d, canEdit, onDone }: { d: WorkOrderDetail; canEdit: boolean; onDone: () => void }) {
  const wo = d.work_order;
  if (!wo.safety_risk && !wo.loto_required && !wo.permit_required) return null;
  return (
    <div className={`kpi-card space-y-2 ${wo.safety_confirmed ? "" : "!border-warn"}`}>
      <div className="font-medium text-sm">Safety</div>
      <div className="text-sm flex gap-3 flex-wrap">
        {wo.safety_risk && <span>Risk: <Pill value={wo.safety_risk} /></span>}
        {wo.loto_required && <span className="status-pill bg-amber-50 text-amber-800">Lock-out / tag-out required</span>}
        {wo.permit_required && <span className="status-pill bg-amber-50 text-amber-800">Work permit required</span>}
      </div>
      {(wo.loto_required || wo.permit_required) && (
        <label className="text-sm flex items-center gap-2">
          <input type="checkbox" disabled={!canEdit} checked={!!wo.safety_confirmed}
            onChange={async (e) => { try { await api.updateWorkOrderFields(wo.id, { safety_confirmed: e.target.checked }); onDone(); } catch (x: any) { alert(x.message); } }} />
          Permit / isolation completed and checked — work may start
        </label>
      )}
    </div>
  );
}

// -------------------------------------------------------------- planning (supervisor)

function Planning({ d, canEdit, onDone }: { d: WorkOrderDetail; canEdit: boolean; onDone: () => void }) {
  const wo = d.work_order;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({
    title: wo.title, priority: wo.priority as string, due_date: wo.due_date || "", failure_category: wo.failure_category || "",
    safety_risk: wo.safety_risk || "", est_h: wo.estimated_hours != null ? String(wo.estimated_hours) : "",
    est_c: wo.estimated_cost != null ? String(wo.estimated_cost) : "", loto: !!wo.loto_required, permit: !!wo.permit_required,
    description: wo.description || "",
  });
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <div className="kpi-card space-y-2">
      <div className="flex items-center justify-between"><div className="font-medium text-sm">Details &amp; planning</div>
        {canEdit && <button onClick={() => setOpen((v) => !v)} className="text-sm text-accent hover:underline">{open ? "Close" : "Edit"}</button>}</div>
      {!open ? (
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <Line l="Failure category" v={label(wo.failure_category)} /><Line l="Supervisor" v={wo.supervisor_name || "—"} />
          <Line l="Estimated hours" v={wo.estimated_hours != null ? String(wo.estimated_hours) : "—"} /><Line l="Estimated cost" v={wo.estimated_cost != null ? fmtMoney(wo.estimated_cost) : "—"} />
          <div className="sm:col-span-2"><Line l="Description" v={wo.description || "—"} /></div>
          {wo.repair_summary && <div className="sm:col-span-2"><Line l="Repair summary" v={wo.repair_summary} /></div>}
          {wo.resolution_code && <Line l="Resolution" v={label(wo.resolution_code)} />}
          {wo.downtime_minutes != null && <Line l="Downtime" v={fmtMinutes(wo.downtime_minutes)} />}
          {wo.diagnosis && <div className="sm:col-span-2"><Line l="Diagnosis" v={wo.diagnosis} /></div>}
          {wo.action_taken && <div className="sm:col-span-2"><Line l="Action taken" v={wo.action_taken} /></div>}
        </dl>
      ) : (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className="text-xs text-muted block mb-1">Title</label><input value={f.title} onChange={(e) => set({ title: e.target.value })} className={inp} /></div>
            <div><label className="text-xs text-muted block mb-1">Priority</label><select value={f.priority} onChange={(e) => set({ priority: e.target.value })} className={inp}>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => <option key={p}>{p}</option>)}</select></div>
            <div><label className="text-xs text-muted block mb-1">Due date</label><DateField value={f.due_date} onChange={(v) => set({ due_date: v })} className="!w-full" /></div>
            <div><label className="text-xs text-muted block mb-1">Failure category</label><select value={f.failure_category} onChange={(e) => set({ failure_category: e.target.value })} className={inp}><option value="">—</option>{FAILURE_CATEGORIES.map((p) => <option key={p}>{p}</option>)}</select></div>
            <div><label className="text-xs text-muted block mb-1">Safety risk</label><select value={f.safety_risk} onChange={(e) => set({ safety_risk: e.target.value })} className={inp}><option value="">—</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></div>
            <div><label className="text-xs text-muted block mb-1">Estimated hours</label><input type="number" min="0" step="0.5" value={f.est_h} onChange={(e) => set({ est_h: e.target.value })} className={inp} /></div>
            <div><label className="text-xs text-muted block mb-1">Estimated cost</label><input type="number" min="0" value={f.est_c} onChange={(e) => set({ est_c: e.target.value })} className={inp} /></div>
            <div className="flex gap-4 text-sm items-center"><label className="flex gap-1.5"><input type="checkbox" checked={f.loto} onChange={(e) => set({ loto: e.target.checked })} /> Lock-out / tag-out</label><label className="flex gap-1.5"><input type="checkbox" checked={f.permit} onChange={(e) => set({ permit: e.target.checked })} /> Work permit</label></div>
            <div className="sm:col-span-2"><label className="text-xs text-muted block mb-1">Description</label><textarea rows={2} value={f.description} onChange={(e) => set({ description: e.target.value })} className={inp} /></div>
          </div>
          {err && <div className="text-sm text-bad">{err}</div>}
          <button className="text-sm px-3 py-1.5 bg-accent text-white rounded-sm" onClick={async () => {
            setErr(null);
            try {
              await api.updateWorkOrderFields(wo.id, {
                title: f.title, priority: f.priority, due_date: f.due_date || null, failure_category: f.failure_category || null,
                safety_risk: f.safety_risk || null, estimated_hours: f.est_h === "" ? null : Number(f.est_h),
                estimated_cost: f.est_c === "" ? null : Number(f.est_c), loto_required: f.loto, permit_required: f.permit, description: f.description,
              });
              setOpen(false); onDone();
            } catch (e: any) { setErr(e.message); }
          }}>Save</button>
        </div>
      )}
    </div>
  );
}
function Line({ l, v }: { l: string; v: string }) { return <div className="flex justify-between gap-4"><dt className="text-muted shrink-0">{l}</dt><dd className="text-right whitespace-pre-wrap">{v}</dd></div>; }

// -------------------------------------------------------------- checklist

function Checklist({ d, canEdit, onDone }: { d: WorkOrderDetail; canEdit: boolean; onDone: () => void }) {
  const cl = d.checklist;
  const [ans, setAns] = useState<Record<string, { result?: string; reading?: string; note?: string }>>(
    Object.fromEntries(cl.items.map((i) => [i.id, { result: i.result || undefined, reading: i.reading || "", note: i.note || "" }])));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setAns(Object.fromEntries(cl.items.map((i) => [i.id, { result: i.result || undefined, reading: i.reading || "", note: i.note || "" }])));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cl.template) return null;

  async function save() {
    setMsg(null);
    const answers: ChecklistAnswer[] = cl.items.filter((i) => ans[i.id]?.result).map((i) => ({
      item_id: i.id, result: ans[i.id].result as any, reading: ans[i.id].reading || undefined, note: ans[i.id].note || undefined }));
    try { await api.saveWorkOrderChecklist(d.work_order.id, answers); setMsg({ ok: true, text: "Checklist saved." }); onDone(); }
    catch (e: any) { setMsg({ ok: false, text: e.message }); }
  }
  return (
    <div className="kpi-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-medium text-sm">{cl.template.name} <span className="text-xs text-muted font-normal">· version {cl.template.version}</span></div>
      <ul className="divide-y divide-border">
        {cl.items.map((i) => {
          const a = ans[i.id] || {};
          return (
            <li key={i.id} className="px-4 py-3 space-y-2">
              <div className="text-sm">{i.text}{i.required && <span className="text-bad ml-1">*</span>}
                {i.critical && <span className="status-pill bg-red-50 text-bad ml-2">critical</span>}</div>
              <div className="flex flex-wrap items-center gap-3">
                {(["PASS", "FAIL", "NA"] as const).map((r) => (
                  <label key={r} className={`text-xs px-2.5 py-1 border rounded-sm cursor-pointer ${a.result === r ? (r === "PASS" ? "bg-green-50 border-good text-good" : r === "FAIL" ? "bg-red-50 border-bad text-bad" : "bg-gray-100 border-border") : "border-border"}`}>
                    <input type="radio" className="hidden" disabled={!canEdit} checked={a.result === r} onChange={() => setAns((x) => ({ ...x, [i.id]: { ...x[i.id], result: r } }))} />{r === "NA" ? "N/A" : r.charAt(0) + r.slice(1).toLowerCase()}
                  </label>
                ))}
                {i.requires_reading && (
                  <span className="flex items-center gap-1 text-xs">Reading <input disabled={!canEdit} value={a.reading || ""} onChange={(e) => setAns((x) => ({ ...x, [i.id]: { ...x[i.id], reading: e.target.value } }))} className="border border-border rounded-sm px-2 py-1 w-24 text-sm" /> {i.reading_unit}</span>
                )}
                <input disabled={!canEdit} value={a.note || ""} onChange={(e) => setAns((x) => ({ ...x, [i.id]: { ...x[i.id], note: e.target.value } }))} placeholder="Note" className="border border-border rounded-sm px-2 py-1 text-sm flex-1 min-w-[140px]" />
              </div>
              {i.evidence_on_fail && a.result === "FAIL" && <div className="text-xs text-warn">Add a photo below for this failed check.</div>}
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3 border-t border-border flex items-center gap-3 flex-wrap">
        {canEdit && <button onClick={save} className="text-sm px-3 py-1.5 bg-accent text-white rounded-sm">Save checklist</button>}
        {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
        {cl.blockers.length > 0 && <span className="text-xs text-warn">{cl.blockers.join(" • ")}</span>}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- labour

function Labour({ d, people, isEditor, canEdit, meId, onDone }: { d: WorkOrderDetail; people: DirectoryPerson[]; isEditor: boolean; canEdit: boolean; meId?: string; onDone: () => void }) {
  const [tech, setTech] = useState(meId || "");
  const [mode, setMode] = useState<"times" | "hours">("hours");
  const [start, setStart] = useState(nowLocalInput(-60));
  const [end, setEnd] = useState(nowLocalInput());
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const total = d.labour.reduce((s, l) => s + l.hours, 0);
  const cur = d.cost_summary.currency;

  async function add() {
    setErr(null);
    try {
      await api.addLabour(d.work_order.id, {
        technician_id: isEditor && tech ? tech : undefined, note: note || undefined,
        ...(mode === "times" ? { started_at: localInputToApi(start), ended_at: localInputToApi(end) } : { hours: Number(hours) }),
      });
      setHours(""); setNote(""); onDone();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="kpi-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-medium text-sm">Labour ({Math.round(total * 100) / 100} h)</div>
      {d.labour.length > 0 && (
        <table className="data-table">
          <thead><tr><th>Technician</th><th>From</th><th>To</th><th>Hours</th><th>Rate</th><th>Cost</th><th /></tr></thead>
          <tbody>{d.labour.map((l) => (
            <tr key={l.id}>
              <td>{l.technician_name}</td><td className="text-xs">{fmtDateTime(l.started_at)}</td><td className="text-xs">{fmtDateTime(l.ended_at)}</td>
              <td>{l.hours}</td><td>{fmtMoney(l.hourly_rate, cur)}/h</td><td>{fmtMoney(l.cost, cur)}</td>
              <td>{canEdit && <button className="text-xs text-bad" onClick={() => confirm("Remove this labour entry?") && api.deleteLabour(d.work_order.id, l.id).then(onDone).catch((e) => alert(e.message))}>Remove</button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {canEdit && (
        <div className="p-4 border-t border-border space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            {isEditor && (
              <select value={tech} onChange={(e) => setTech(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
                <option value="">Me</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            )}
            <select value={mode} onChange={(e) => setMode(e.target.value as any)} className="border border-border rounded-sm px-2 py-1.5 text-sm"><option value="hours">Enter hours</option><option value="times">Enter start / end</option></select>
            {mode === "hours" ? <input type="number" min="0" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Hours" className="border border-border rounded-sm px-2 py-1.5 text-sm w-24" /> : (
              <>
                <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm" />
                <input type="datetime-local" value={end} max={nowLocalInput()} onChange={(e) => setEnd(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm" />
              </>)}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" className="border border-border rounded-sm px-2 py-1.5 text-sm flex-1 min-w-[120px]" />
            <button onClick={add} className="text-sm px-3 py-1.5 bg-ink text-white rounded-sm">Add labour</button>
          </div>
          {err && <div className="text-sm text-bad">{err}</div>}
          <div className="text-xs text-muted">Each entry is costed at the technician's rate on the day it is entered; later rate changes do not change it.</div>
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------- parts

function Parts({ d, parts, canEdit, onDone }: { d: WorkOrderDetail; parts: SparePart[]; canEdit: boolean; onDone: () => void }) {
  const [partId, setPartId] = useState("");
  const [qty, setQty] = useState("1");
  const [rid, setRid] = useState(newRequestId());   // same id on a double-click means the move is applied once
  const [err, setErr] = useState<string | null>(null);
  const cur = d.cost_summary.currency;
  const sel = parts.find((p) => p.id === partId);

  async function consume() {
    setErr(null);
    try { await api.consumePartRequest(d.work_order.id, { spare_part_id: partId, quantity: Number(qty), request_id: rid }); setRid(newRequestId()); setQty("1"); onDone(); }
    catch (e: any) { setErr(e.message); }
  }
  async function giveBack(spare_part_id: string, quantity: number) {
    const q = prompt(`Return how many? (up to ${quantity})`, String(quantity));
    if (!q) return;
    try { await api.returnPart(d.work_order.id, { spare_part_id, quantity: Number(q), request_id: newRequestId() }); onDone(); }
    catch (e: any) { alert(e.message); }
  }
  // net per part
  const net = new Map<string, { code?: string | null; name?: string | null; qty: number; cost: number }>();
  d.parts.forEach((p) => {
    const cur = net.get(p.spare_part_id) || { code: p.part_code, name: p.part_name, qty: 0, cost: 0 };
    cur.qty += p.quantity; cur.cost += p.cost; net.set(p.spare_part_id, cur);
  });
  return (
    <div className="kpi-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-medium text-sm">Spare parts used</div>
      {net.size > 0 && (
        <table className="data-table">
          <thead><tr><th>Part</th><th>Net quantity</th><th>Cost</th><th /></tr></thead>
          <tbody>{Array.from(net.entries()).map(([pid, p]) => (
            <tr key={pid}><td>{p.code} — {p.name}</td><td>{p.qty}</td><td>{fmtMoney(p.cost, cur)}</td>
              <td>{canEdit && p.qty > 0 && <button className="text-xs text-accent" onClick={() => giveBack(pid, p.qty)}>Return unused</button>}</td></tr>))}</tbody>
        </table>
      )}
      {canEdit ? (
        <div className="p-4 border-t border-border space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <select value={partId} onChange={(e) => setPartId(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm flex-1 min-w-[200px]">
              <option value="">Choose a part…</option>
              {parts.map((p) => <option key={p.id} value={p.id} disabled={p.available_stock <= 0}>{p.part_code} — {p.name} ({p.available_stock} {p.unit} available)</option>)}</select>
            <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm w-20" />
            <button onClick={consume} disabled={!partId || !Number(qty)} className="text-sm px-3 py-1.5 bg-ink text-white rounded-sm disabled:opacity-50">Book part</button>
          </div>
          {sel && sel.low_stock && <div className="text-xs text-warn">Stock is low for this part ({sel.stock_on_hand} left, minimum {sel.minimum_stock}).</div>}
          {err && <div className="text-sm text-bad">{err}</div>}
        </div>
      ) : net.size === 0 ? <div className="px-4 py-4 text-sm text-muted">Start the work order to book parts to it.</div> : null}
    </div>
  );
}

// -------------------------------------------------------------- costs

function Costs({ d, canEdit, isEditor, isManager, onDone }: { d: WorkOrderDetail; canEdit: boolean; isEditor: boolean; isManager: boolean; onDone: () => void }) {
  const [cat, setCat] = useState("EXTERNAL_SERVICE");
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [tax, setTax] = useState("");
  const [vendor, setVendor] = useState("");
  const [inv, setInv] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const cur = d.cost_summary.currency;
  const inp2 = "border border-border rounded-sm px-2 py-1.5 text-sm";

  async function add() {
    setErr(null);
    try {
      await api.addCost(d.work_order.id, { category: cat, description: desc, amount: Number(amount), tax_amount: tax ? Number(tax) : 0, vendor: vendor || undefined, invoice_ref: inv || undefined });
      setDesc(""); setAmount(""); setTax(""); setVendor(""); setInv(""); onDone();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="kpi-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-medium text-sm">External services &amp; other costs</div>
      {d.cost_items.length > 0 && (
        <div className="overflow-x-auto"><table className="data-table">
          <thead><tr><th>Type</th><th>Description</th><th>Vendor / invoice</th><th>Amount (+tax)</th><th>Entered by</th><th>Approval</th><th /></tr></thead>
          <tbody>{d.cost_items.map((c) => (
            <tr key={c.id}>
              <td className="text-xs">{label(c.category)}</td><td>{c.description}</td>
              <td className="text-xs">{[c.vendor, c.invoice_ref].filter(Boolean).join(" / ") || "—"}</td>
              <td>{fmtMoney(c.amount + c.tax_amount, cur)}</td><td className="text-xs">{c.recorded_by_name}</td>
              <td>{c.approved ? <span className="text-good text-xs">Approved{c.approved_by_name ? ` by ${c.approved_by_name}` : ""}</span> :
                isEditor ? <button className="text-xs text-accent" onClick={() => api.approveCost(d.work_order.id, c.id).then(onDone).catch((e) => alert(e.message))}>Approve</button> : <span className="text-xs text-warn">Waiting</span>}</td>
              <td>{canEdit && (!c.approved || isManager) && <button className="text-xs text-bad" onClick={() => confirm("Remove this cost?") && api.deleteCost(d.work_order.id, c.id).then(onDone).catch((e) => alert(e.message))}>Remove</button>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      {canEdit && (
        <div className="p-4 border-t border-border space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <select value={cat} onChange={(e) => setCat(e.target.value)} className={inp2}><option value="EXTERNAL_SERVICE">External service</option><option value="CONSUMABLE">Consumable</option><option value="OTHER">Other</option></select>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Description" className={`${inp2} flex-1 min-w-[160px]`} />
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className={`${inp2} w-28`} />
            <input type="number" min="0" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="Tax" className={`${inp2} w-20`} />
            {cat === "EXTERNAL_SERVICE" && <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor *" className={`${inp2} w-36`} />}
            <input value={inv} onChange={(e) => setInv(e.target.value)} placeholder="Invoice no." className={`${inp2} w-28`} />
            <button onClick={add} disabled={!desc.trim() || !Number(amount)} className="text-sm px-3 py-1.5 bg-ink text-white rounded-sm disabled:opacity-50">Add cost</button>
          </div>
          {err && <div className="text-sm text-bad">{err}</div>}
          <div className="text-xs text-muted">A cost counts towards the actual total only after a supervisor/manager approves it (large amounts need a manager).</div>
        </div>
      )}
    </div>
  );
}
