"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { api, BreakdownDetail, CorrectiveAction, DirectoryPerson, FiveWhy } from "@/lib/api";
import { Pill } from "@/components/Pill";
import { EvidencePanel } from "@/components/EvidencePanel";
import { DateField } from "@/components/DateField";
import { fmtDate, fmtDateTime, fmtMinutes, fmtMoney, label, localInputToApi, nowLocalInput } from "@/lib/format";

const FISHBONE = [
  ["people", "People"], ["machine", "Machine"], ["method", "Method"],
  ["material", "Material"], ["measurement", "Measurement"], ["environment", "Environment"],
] as const;

const STATUS_HELP: Record<string, string> = {
  UNDER_DIAGNOSIS: "Start diagnosing",
  REPAIR_IN_PROGRESS: "Repair in progress",
  AWAITING_VERIFICATION: "Repair done — send for verification",
  RESTORED: "Verify: machine is running again",
  CLOSED: "Close incident",
};

export default function BreakdownDetailClient({ id }: { id: string }) {
  const [d, setD] = useState<BreakdownDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();
  const [people, setPeople] = useState<DirectoryPerson[]>([]);
  const [evidence, setEvidence] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const [detail, ev] = await Promise.all([api.breakdownDetail(id), api.evidenceList("breakdown", id)]);
      setD(detail);
      setEvidence(ev);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    setRole(getUser()?.role);
    load();
    api.directory().then(setPeople).catch(() => {});
  }, [load]);

  if (error) return <div className="p-6 space-y-2"><p className="text-sm text-bad">{error}</p><Link href="/breakdowns" className="text-sm text-accent hover:underline">← Breakdowns</Link></div>;
  if (!d) return <div className="p-6 text-sm text-muted">Loading…</div>;

  const isEditor = role === "SUPERVISOR" || role === "MANAGER" || role === "ADMIN";
  const isManager = role === "MANAGER" || role === "ADMIN";
  const canWork = !!role && role !== "VIEWER";
  const closed = d.status === "CLOSED";

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <Link href="/breakdowns" className="text-xs text-accent hover:underline">← Breakdowns</Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-lg font-semibold text-ink font-mono">{d.bd_number}</h1>
          <Pill value={d.status} /><Pill value={d.severity} />
          {d.recurring && <span className="status-pill bg-amber-50 text-amber-800">Repeat failure</span>}
          {d.critical_machine && <span className="status-pill bg-red-50 text-bad">Critical machine</span>}
        </div>
        <p className="text-sm text-muted">
          <Link href={`/machines/${d.machine_id}`} className="text-accent hover:underline">{d.machine_number} {d.machine_name}</Link>
          {d.location ? ` · ${d.location}` : ""} · reported by {d.reported_by_name || "—"}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Machine stopped" value={fmtDateTime(d.breakdown_at)} />
        <Stat label="Restored" value={d.resumed_at ? fmtDateTime(d.resumed_at) : "Still down"} tone={d.resumed_at ? undefined : "bad"} />
        <Stat label="Downtime" value={fmtMinutes(d.downtime_minutes)} sub={d.costs.downtime_cost ? `≈ ${fmtMoney(d.costs.downtime_cost, d.costs.currency)}` : undefined} />
        <Stat label="Repair cost (actual)" value={fmtMoney(d.costs.actual_total, d.costs.currency)}
          sub={d.costs.pending_approval ? `+ ${fmtMoney(d.costs.pending_approval, d.costs.currency)} awaiting approval` : undefined} />
      </div>

      {!closed && canWork && <Lifecycle d={d} isEditor={isEditor} onDone={load} />}
      {closed && (
        <div className="kpi-card text-sm flex items-center justify-between gap-3 flex-wrap">
          <span>Closed on {fmtDateTime(d.closed_at)} by {d.closed_by_name || "—"}. It is read-only.</span>
          {isManager && <ReopenBox onDone={load} id={d.id} />}
        </div>
      )}

      <div className="kpi-card space-y-2">
        <div className="font-medium text-sm">What happened</div>
        <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          <Row label="Category" value={label(d.failure_category)} />
          <Row label="Failure mode" value={d.failure_mode} />
          <Row label="Production impact" value={label(d.production_impact)} />
          <Row label="Verified by" value={d.verified_by_name} />
          <div className="sm:col-span-2"><Row label="Symptom / first observation" value={d.cause} /></div>
          <div className="sm:col-span-2"><Row label="Temporary action" value={d.temporary_action} /></div>
          <div className="sm:col-span-2"><Row label="Permanent corrective action" value={d.corrective_action} /></div>
        </dl>
      </div>

      <RcaEditor d={d} locked={closed || !canWork} isEditor={isEditor} onSaved={load} />
      <Actions d={d} people={people} canWork={canWork && !closed} isEditor={isEditor} onChanged={load} />

      <div className="kpi-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="font-medium text-sm">Work orders ({d.work_orders.length})</div>
          {canWork && !closed && (
            <button className="text-sm text-accent hover:underline" onClick={async () => {
              try { const r = await api.raiseWorkOrderFromBreakdown(d.id); window.location.href = `/work-orders/${r.id}`; }
              catch (e: any) { alert(e.message); }
            }}>+ Raise repair work order</button>
          )}
        </div>
        {d.work_orders.length === 0 ? <div className="px-4 py-4 text-sm text-muted">No work order yet.</div> : (
          <table className="data-table"><tbody>
            {d.work_orders.map((w) => (
              <tr key={w.id}>
                <td className="font-mono text-xs"><Link href={`/work-orders/${w.id}`} className="text-accent hover:underline">{w.display_number}</Link></td>
                <td>{w.title}</td><td>{w.assigned_to_name || "Unassigned"}</td>
                <td>{w.cancelled ? <Pill value="CANCELLED" /> : <Pill value={w.status} />}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>

      <div className="kpi-card space-y-1">
        <div className="font-medium text-sm">Cost of this incident</div>
        <dl className="text-sm grid grid-cols-2 sm:grid-cols-5 gap-3">
          <Stat small label="Parts" value={fmtMoney(d.costs.parts, d.costs.currency)} />
          <Stat small label={`Labour (${d.costs.labour_hours} h)`} value={fmtMoney(d.costs.labour, d.costs.currency)} />
          <Stat small label="External services" value={fmtMoney(d.costs.external_services, d.costs.currency)} />
          <Stat small label="Consumables + other" value={fmtMoney(d.costs.consumables + d.costs.other, d.costs.currency)} />
          <Stat small label="Total actual" value={fmtMoney(d.costs.actual_total, d.costs.currency)} />
        </dl>
        <p className="text-xs text-muted">Only recorded and approved costs are counted. Downtime cost is shown above, not added to the repair cost.</p>
      </div>

      <EvidencePanel kind="breakdown" entityId={d.id} files={evidence} canUpload={canWork && !closed} canDelete={isManager} onChanged={load} />

      {d.similar.length > 0 && (
        <div className="kpi-card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-medium text-sm">Similar earlier incidents</div>
          <table className="data-table">
            <thead><tr><th>ID</th><th>Date</th><th>Machine</th><th>Failure</th><th>Root cause</th><th>Status</th></tr></thead>
            <tbody>
              {d.similar.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs"><Link href={`/breakdowns/${s.id}`} className="text-accent hover:underline">{s.bd_number}</Link></td>
                  <td>{fmtDate(s.breakdown_at)}</td>
                  <td>{s.machine_number}{s.same_machine && <span className="text-xs text-muted"> (same machine)</span>}</td>
                  <td>{s.failure_mode || label(s.failure_category)}</td>
                  <td className="text-xs">{s.root_cause || "—"}</td>
                  <td><Pill value={s.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label: l, value, sub, tone, small }: { label: string; value: string; sub?: string; tone?: "bad"; small?: boolean }) {
  return (
    <div className={small ? "" : "kpi-card"}>
      <div className="kpi-label">{l}</div>
      <div className={`${small ? "text-sm font-medium" : "text-base font-semibold"} ${tone === "bad" ? "text-bad" : "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Row({ label: l, value }: { label: string; value?: string | null }) {
  return <div className="flex justify-between gap-4"><dt className="text-muted shrink-0">{l}</dt><dd className="text-right whitespace-pre-wrap">{value || "—"}</dd></div>;
}

function ReopenBox({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-accent hover:underline">Reopen…</button>;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being reopened?" className="border border-border rounded-sm px-2 py-1 text-sm w-64" />
      <button className="text-sm px-2 py-1 bg-ink text-white rounded-sm" onClick={async () => {
        try { await api.breakdownReopen(id, reason); onDone(); } catch (e: any) { setErr(e.message); }
      }}>Reopen</button>
      {err && <span className="text-xs text-bad">{err}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- lifecycle

function Lifecycle({ d, isEditor, onDone }: { d: BreakdownDetail; isEditor: boolean; onDone: () => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [restoredAt, setRestoredAt] = useState(nowLocalInput());
  const [temp, setTemp] = useState(d.temporary_action || "");
  const [corr, setCorr] = useState(d.corrective_action || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nexts = d.allowed_next_statuses.filter((s) => s !== "CLOSED" || isEditor);

  async function go() {
    if (!target) return;
    setBusy(true); setErr(null);
    try {
      await api.breakdownStatus(d.id, {
        status: target, note: note.trim() || undefined,
        resumed_at: target === "AWAITING_VERIFICATION" || target === "RESTORED" ? localInputToApi(restoredAt) : undefined,
        temporary_action: temp.trim() || undefined, corrective_action: corr.trim() || undefined,
      });
      setTarget(null); setNote("");
      onDone();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const needsTime = target === "AWAITING_VERIFICATION" || target === "RESTORED";
  const needsActions = needsTime || target === "CLOSED";
  const inp = "w-full border border-border rounded-sm px-2 py-1.5 text-sm";
  return (
    <div className="kpi-card space-y-3">
      <div className="font-medium text-sm">Next step</div>
      {nexts.length === 0 ? <p className="text-sm text-muted">No further steps.</p> : (
        <div className="flex flex-wrap gap-2">
          {nexts.map((s) => (
            <button key={s} onClick={() => { setTarget(s); setErr(null); }}
              className={`text-sm px-3 py-1.5 border rounded-sm ${target === s ? "bg-ink text-white border-ink" : "border-border hover:bg-surface"}`}>
              {STATUS_HELP[s] || label(s)}
            </button>
          ))}
        </div>
      )}
      {target && (
        <div className="space-y-3 border-t border-border pt-3">
          {needsTime && (
            <div>
              <label className="text-xs text-muted block mb-1">When did the machine run again?</label>
              <input type="datetime-local" value={restoredAt} max={nowLocalInput()} onChange={(e) => setRestoredAt(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm" />
            </div>
          )}
          {needsActions && (
            <>
              <div><label className="text-xs text-muted block mb-1">Temporary action</label><input value={temp} onChange={(e) => setTemp(e.target.value)} className={inp} /></div>
              <div><label className="text-xs text-muted block mb-1">Permanent corrective action {target !== "AWAITING_VERIFICATION" && "*"}</label><textarea rows={2} value={corr} onChange={(e) => setCorr(e.target.value)} className={inp} /></div>
            </>
          )}
          <div><label className="text-xs text-muted block mb-1">Note {d.status === "RESTORED" || d.status === "AWAITING_VERIFICATION" ? (target === "REPAIR_IN_PROGRESS" ? "(required)" : "") : "(optional)"}</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inp} /></div>
          {err && <div className="text-sm text-bad">{err}</div>}
          <div className="flex gap-2">
            <button onClick={go} disabled={busy} className="text-sm px-3 py-1.5 bg-accent text-white rounded-sm disabled:opacity-50">{busy ? "Saving…" : "Confirm"}</button>
            <button onClick={() => setTarget(null)} className="text-sm px-3 py-1.5 border border-border rounded-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- RCA

function RcaEditor({ d, locked, isEditor, onSaved }: { d: BreakdownDetail; locked: boolean; isEditor: boolean; onSaved: () => void }) {
  const r = d.rca || {};
  const [symptom, setSymptom] = useState(r.symptom || d.cause || "");
  const [observed, setObserved] = useState(r.observed_condition || "");
  const [immediate, setImmediate] = useState(r.immediate_cause || "");
  const [factors, setFactors] = useState((r.contributing_factors || []).join("\n"));
  const [whys, setWhys] = useState<FiveWhy[]>(
    r.five_whys && r.five_whys.length ? r.five_whys : [{ question: "Why did the machine stop?", answer: "", evidence: "", confirmed: false }]);
  const [fish, setFish] = useState<Record<string, string>>(
    Object.fromEntries(FISHBONE.map(([k]) => [k, (r.fishbone?.[k] || []).join("\n")])));
  const [root, setRoot] = useState(d.root_cause || "");
  const [status, setStatus] = useState(d.rca_status === "NOT_STARTED" ? "IN_PROGRESS" : d.rca_status);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const setWhy = (i: number, patch: Partial<FiveWhy>) => setWhys((w) => w.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api.saveRca(d.id, {
        symptom, observed_condition: observed, immediate_cause: immediate, contributing_factors: lines(factors),
        five_whys: whys.filter((w) => w.question.trim() || w.answer.trim()),
        fishbone: Object.fromEntries(FISHBONE.map(([k]) => [k, lines(fish[k] || "")])),
        root_cause: root, rca_status: status,
      });
      setMsg({ ok: true, text: "Saved." });
      onSaved();
    } catch (e: any) { setMsg({ ok: false, text: e.message }); }
    finally { setBusy(false); }
  }

  const inp = "w-full border border-border rounded-sm px-2 py-1.5 text-sm disabled:bg-surface";
  return (
    <div className="kpi-card space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="font-medium text-sm">Root cause analysis</div>
        <Pill value={d.rca_status} />
        {d.rca_status === "CONFIRMED" && d.rca_confirmed_by_name && <span className="text-xs text-muted">confirmed by {d.rca_confirmed_by_name}</span>}
      </div>
      <p className="text-xs text-muted">
        A cause is only “confirmed” when each why has evidence and is marked proven. A guess stays “unverified”.
        {" "}{d.severity === "HIGH" || d.severity === "CRITICAL" ? "A supervisor or manager must confirm HIGH/CRITICAL incidents." : ""}
      </p>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label className="text-xs text-muted block mb-1">Symptom</label><textarea rows={2} disabled={locked} value={symptom} onChange={(e) => setSymptom(e.target.value)} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Observed condition (what was found)</label><textarea rows={2} disabled={locked} value={observed} onChange={(e) => setObserved(e.target.value)} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Immediate cause</label><textarea rows={2} disabled={locked} value={immediate} onChange={(e) => setImmediate(e.target.value)} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Contributing factors (one per line)</label><textarea rows={2} disabled={locked} value={factors} onChange={(e) => setFactors(e.target.value)} className={inp} /></div>
      </div>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wide text-muted">Five whys</div>
        {whys.map((w, i) => (
          <div key={i} className="border border-border rounded-sm p-3 space-y-2">
            <div className="flex gap-2 items-start">
              <span className="text-xs text-muted mt-2 w-12 shrink-0">Why {i + 1}</span>
              <div className="flex-1 grid gap-2">
                <input disabled={locked} value={w.question} onChange={(e) => setWhy(i, { question: e.target.value })} placeholder="Question" className={inp} />
                <input disabled={locked} value={w.answer} onChange={(e) => setWhy(i, { answer: e.target.value })} placeholder="Answer" className={inp} />
                <input disabled={locked} value={w.evidence} onChange={(e) => setWhy(i, { evidence: e.target.value })} placeholder="Evidence — what was seen, measured or checked" className={inp} />
                <label className="text-xs flex items-center gap-2">
                  <input type="checkbox" disabled={locked} checked={w.confirmed} onChange={(e) => setWhy(i, { confirmed: e.target.checked })} />
                  Proven by the evidence above (not a guess)
                </label>
              </div>
              {!locked && whys.length > 1 && <button className="text-xs text-bad" onClick={() => setWhys((x) => x.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          </div>
        ))}
        {!locked && whys.length < 7 && (
          <button className="text-sm text-accent hover:underline" onClick={() => setWhys((x) => [...x, { question: "Why?", answer: "", evidence: "", confirmed: false }])}>+ Add why</button>
        )}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-muted mb-2">Fishbone — possible causes (one per line)</div>
        <div className="grid sm:grid-cols-3 gap-3">
          {FISHBONE.map(([k, l]) => (
            <div key={k}><label className="text-xs text-muted block mb-1">{l}</label>
              <textarea rows={3} disabled={locked} value={fish[k]} onChange={(e) => setFish((f) => ({ ...f, [k]: e.target.value }))} className={inp} /></div>
          ))}
        </div>
      </div>

      <div><label className="text-xs text-muted block mb-1">Root cause</label><textarea rows={2} disabled={locked} value={root} onChange={(e) => setRoot(e.target.value)} className={inp} /></div>
      {!locked && (
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-xs text-muted block mb-1">Status of this analysis</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
              <option value="IN_PROGRESS">In progress</option>
              <option value="UNVERIFIED">Unverified (best current view)</option>
              <option value="CONFIRMED" disabled={!isEditor && (d.severity === "HIGH" || d.severity === "CRITICAL")}>Confirmed (proven)</option>
            </select>
          </div>
          <button onClick={save} disabled={busy} className="text-sm px-3 py-1.5 bg-accent text-white rounded-sm disabled:opacity-50">{busy ? "Saving…" : "Save analysis"}</button>
          {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- corrective / preventive actions

function Actions({ d, people, canWork, isEditor, onChanged }: { d: BreakdownDetail; people: DirectoryPerson[]; canWork: boolean; isEditor: boolean; onChanged: () => void }) {
  const [kind, setKind] = useState("CORRECTIVE");
  const [desc, setDesc] = useState("");
  const [owner, setOwner] = useState("");
  const [target, setTarget] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    try {
      await api.addAction(d.id, { kind, description: desc, owner_id: owner || undefined, target_date: target || undefined });
      setDesc(""); setOwner(""); setTarget("");
      onChanged();
    } catch (e: any) { setErr(e.message); }
  }
  async function update(a: CorrectiveAction, patch: Record<string, any>) {
    try { await api.updateAction(d.id, a.id, patch); onChanged(); } catch (e: any) { alert(e.message); }
  }

  const inp = "border border-border rounded-sm px-2 py-1.5 text-sm";
  return (
    <div className="kpi-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-border font-medium text-sm">Corrective &amp; preventive actions ({d.actions.length})</div>
      {d.actions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Type</th><th>Action</th><th>Owner</th><th>Target</th><th>Status</th><th>Effectiveness</th><th /></tr></thead>
            <tbody>
              {d.actions.map((a) => (
                <tr key={a.id}>
                  <td className="text-xs">{label(a.kind)}</td>
                  <td>{a.description}</td>
                  <td>{a.owner_name || "—"}</td>
                  <td className={a.overdue ? "text-bad" : ""}>{fmtDate(a.target_date)}{a.overdue && " (overdue)"}</td>
                  <td>
                    {canWork ? (
                      <select value={a.status} onChange={(e) => update(a, { status: e.target.value })} className={`${inp} text-xs`}>
                        <option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="DONE">Done</option>
                      </select>
                    ) : <Pill value={a.status} />}
                  </td>
                  <td>
                    {a.status === "DONE" && isEditor ? (
                      <select value={a.effectiveness} onChange={(e) => update(a, { effectiveness: e.target.value })} className={`${inp} text-xs`}>
                        <option value="PENDING">Pending review</option><option value="EFFECTIVE">Effective</option><option value="NOT_EFFECTIVE">Not effective</option>
                      </select>
                    ) : <Pill value={a.effectiveness} />}
                  </td>
                  <td>{isEditor && canWork && <button onClick={() => confirm("Remove this action?") && api.deleteAction(d.id, a.id).then(onChanged).catch((e) => alert(e.message))} className="text-xs text-bad">Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canWork && (
        <div className="p-4 border-t border-border space-y-2">
          <div className="flex flex-wrap gap-2 items-end">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className={inp}><option value="CORRECTIVE">Corrective</option><option value="PREVENTIVE">Preventive</option></select>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What will be done?" className={`${inp} flex-1 min-w-[200px]`} />
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={inp}>
              <option value="">Owner…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div><DateField value={target} onChange={setTarget} placeholder="Target dd-mm-yyyy" className="!w-36" /></div>
            <button onClick={add} disabled={!desc.trim()} className="text-sm px-3 py-1.5 bg-ink text-white rounded-sm disabled:opacity-50">Add</button>
          </div>
          {err && <div className="text-sm text-bad">{err}</div>}
          {(d.severity === "HIGH" || d.severity === "CRITICAL") && d.actions.length === 0 && (
            <div className="text-xs text-muted">A HIGH/CRITICAL incident needs at least one action, all finished, before it can be closed.</div>
          )}
        </div>
      )}
    </div>
  );
}
