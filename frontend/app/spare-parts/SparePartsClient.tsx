"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { api, Machine, PartUsage, SparePart, SparePartTransaction, StockAlerts } from "@/lib/api";
import { Pill } from "@/components/Pill";
import { KpiCard } from "@/components/KpiCard";
import { fmtDate, fmtDateTime, fmtMoney, label } from "@/lib/format";

const inp = "w-full border border-border rounded-sm px-2 py-1.5 text-sm";

function rid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

export default function SparePartsClient({ machines, initialLowOnly }: { machines: Machine[]; initialLowOnly: boolean }) {
  const [parts, setParts] = useState<SparePart[]>([]);
  const [alerts, setAlerts] = useState<StockAlerts | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [machineId, setMachineId] = useState("");
  const [lowOnly, setLowOnly] = useState(initialLowOnly);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [role, setRole] = useState<string | undefined>();

  useEffect(() => setRole(getUser()?.role), []);
  useEffect(() => { const t = setTimeout(() => setQDebounced(q), 300); return () => clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    try {
      const [p, a, c] = await Promise.all([
        api.searchSpareParts({ q: qDebounced, category, machine_id: machineId, low_stock_only: lowOnly }),
        api.stockAlerts(), api.sparePartCategories(),
      ]);
      setParts(p); setAlerts(a); setCategories(c); setError(null);
    } catch (e: any) { setError(e.message); }
  }, [qDebounced, category, machineId, lowOnly]);
  useEffect(() => { load(); }, [load]);

  const canManage = role === "SUPERVISOR" || role === "MANAGER" || role === "ADMIN";
  const stockValue = parts.reduce((s, p) => s + p.stock_on_hand * (p.unit_cost || 0), 0);

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-ink">Spare Parts</h1>
          <p className="text-sm text-muted">Stock, usage and low-stock warnings. Stock only changes through a recorded movement.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Link href="/import/data?kind=spare-parts" className="text-sm px-3 py-1.5 rounded-sm border border-border hover:bg-surface">Import from Excel</Link>
            <button onClick={() => setShowForm((v) => !v)} className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90">{showForm ? "Cancel" : "New part"}</button>
          </div>
        )}
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}
      {showForm && <CreateForm machines={machines} onDone={() => { setShowForm(false); load(); }} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Parts shown" value={parts.length} />
        <KpiCard label="Low stock" value={alerts?.low_stock.length ?? "—"} tone={alerts && alerts.low_stock.length > 0 ? "warn" : undefined} />
        <KpiCard label="PM at risk (14 days)" value={alerts ? new Set(alerts.pm_at_risk.map((r) => r.pm_plan_id)).size : "—"} tone={alerts && alerts.pm_at_risk.length > 0 ? "bad" : undefined} />
        <KpiCard label="Stock value (shown)" value={fmtMoney(stockValue)} />
      </div>

      {alerts && (alerts.pm_at_risk.length > 0 || alerts.work_orders_waiting_for_parts.length > 0) && (
        <div className="kpi-card space-y-2 !border-warn">
          <div className="font-medium text-sm">Needs attention</div>
          {alerts.pm_at_risk.slice(0, 8).map((r) => (
            <div key={r.part_id + r.pm_plan_id} className="text-sm">
              <Link href={`/pm/${r.pm_plan_id}`} className="text-accent hover:underline">PM on {r.machine_number}, {fmtDate(r.planned_date)}</Link>
              {" "}may be affected: <b>{r.part_code}</b> {r.part_name} is low ({r.stock_on_hand} left, minimum {r.minimum_stock}{r.lead_time_days ? `, ${r.lead_time_days}-day lead time` : ""}).
            </div>
          ))}
          {alerts.work_orders_waiting_for_parts.map((w) => (
            <div key={w.id} className="text-sm"><Link href={`/work-orders/${w.id}`} className="text-accent hover:underline">{w.display_number}</Link> {w.title} is waiting for parts.</div>
          ))}
        </div>
      )}

      <div className="kpi-card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]"><label className="text-xs text-muted block mb-1">Search part number, name, vendor, location</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} className={inp} placeholder="Search…" /></div>
        <div><label className="text-xs text-muted block mb-1">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm"><option value="">All</option>{categories.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="text-xs text-muted block mb-1">Fits machine</label>
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm max-w-[170px]"><option value="">Any</option>{machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number}</option>)}</select></div>
        <label className="text-sm flex items-center gap-1.5 pb-1.5"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
      </div>

      <div className="kpi-card !p-0 overflow-x-auto">
        {parts.length === 0 ? <div className="px-4 py-6 text-sm text-muted">No parts match.</div> : (
          <table className="data-table">
            <thead><tr><th>Part no.</th><th>Name</th><th>Category</th><th>On hand</th><th>Min</th><th>Unit cost</th><th>Location</th><th /></tr></thead>
            <tbody>
              {parts.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td className="font-mono text-xs">{p.part_code}</td>
                    <td>{p.name}</td><td className="text-xs">{p.category || "—"}</td>
                    <td className={p.low_stock ? "text-bad font-semibold" : ""}>{p.stock_on_hand} {p.unit}{p.reserved_stock ? <span className="text-xs text-muted"> ({p.reserved_stock} reserved)</span> : null}
                      {p.low_stock && <span className="status-pill bg-red-50 text-bad ml-2">{p.out_of_stock ? "out" : "low"}</span>}</td>
                    <td>{p.minimum_stock}</td><td>{p.unit_cost != null ? fmtMoney(p.unit_cost) : "—"}</td><td className="text-xs">{p.storage_location || "—"}</td>
                    <td><button className="text-xs text-accent hover:underline" onClick={() => setOpenId(openId === p.id ? null : p.id)}>{openId === p.id ? "Close" : "Open"}</button></td>
                  </tr>
                  {openId === p.id && <tr><td colSpan={8} className="bg-surface !p-0"><PartPanel part={p} canManage={canManage} role={role} machines={machines} onChanged={load} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PartPanel({ part, canManage, role, machines, onChanged }: { part: SparePart; canManage: boolean; role?: string; machines: Machine[]; onChanged: () => void }) {
  const [tab, setTab] = useState<"history" | "usage" | "adjust" | "edit">("history");
  const [txns, setTxns] = useState<SparePartTransaction[]>([]);
  const [usage, setUsage] = useState<PartUsage[]>([]);
  const reload = useCallback(() => {
    api.sparePartTransactions(part.id).then(setTxns).catch(() => {});
    api.partUsage(part.id).then(setUsage).catch(() => {});
  }, [part.id]);
  useEffect(() => { reload(); }, [reload, part.stock_on_hand]);
  const canAdjust = !!role && role !== "VIEWER";
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2 text-sm">
        {(["history", "usage", ...(canAdjust ? ["adjust"] : []), ...(canManage ? ["edit"] : [])] as const).map((t) => (
          <button key={t} onClick={() => setTab(t as any)} className={`px-3 py-1 rounded-sm border ${tab === t ? "bg-ink text-white border-ink" : "border-border bg-panel"}`}>{{ history: "Stock history", usage: "Where used", adjust: "Add / adjust stock", edit: "Edit details" }[t as string]}</button>
        ))}
      </div>
      {tab === "history" && (
        <table className="data-table bg-panel"><thead><tr><th>When</th><th>Type</th><th>Change</th><th>Unit cost</th><th>Work order</th><th>By</th><th>Reason</th></tr></thead>
          <tbody>{txns.length === 0 ? <tr><td colSpan={7} className="text-muted">No movements yet.</td></tr> : txns.map((t) => (
            <tr key={t.id}><td className="text-xs whitespace-nowrap">{fmtDateTime(t.created_at)}</td><td className="text-xs">{label(t.txn_type)}</td>
              <td className={t.change < 0 ? "text-bad" : "text-good"}>{t.change > 0 ? "+" : ""}{t.change}</td><td>{t.unit_cost != null ? fmtMoney(t.unit_cost) : "—"}</td>
              <td className="text-xs">{t.work_order_id ? <Link className="text-accent hover:underline" href={`/work-orders/${t.work_order_id}`}>{t.work_order_number || "work order"}</Link> : "—"}</td>
              <td className="text-xs">{t.performed_by_name || "—"}</td><td className="text-xs">{t.reason || "—"}</td></tr>))}</tbody></table>
      )}
      {tab === "usage" && (
        <table className="data-table bg-panel"><thead><tr><th>Work order</th><th>Machine</th><th>Breakdown</th><th>Net quantity</th><th>Cost</th><th>Last movement</th></tr></thead>
          <tbody>{usage.length === 0 ? <tr><td colSpan={6} className="text-muted">Not used on any work order yet.</td></tr> : usage.map((u) => (
            <tr key={u.work_order_id}><td><Link className="text-accent hover:underline" href={`/work-orders/${u.work_order_id}`}>{u.display_number}</Link> <span className="text-xs text-muted">{u.title}</span></td>
              <td>{u.machine_number}</td><td className="text-xs">{u.breakdown_id ? <Link className="text-accent hover:underline" href={`/breakdowns/${u.breakdown_id}`}>{u.bd_number}</Link> : "—"}</td>
              <td>{u.quantity}</td><td>{fmtMoney(u.cost)}</td><td className="text-xs">{fmtDate(u.last_movement)}</td></tr>))}</tbody></table>
      )}
      {tab === "adjust" && <Adjust part={part} role={role} onDone={() => { reload(); onChanged(); }} />}
      {tab === "edit" && <Edit part={part} machines={machines} onDone={onChanged} />}
    </div>
  );
}

function Adjust({ part, role, onDone }: { part: SparePart; role?: string; onDone: () => void }) {
  const isTech = role === "TECHNICIAN";
  const [kind, setKind] = useState(isTech ? "DAMAGED" : "RECEIPT");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const [req, setReq] = useState(rid());
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function go() {
    setErr(null); setOk(null);
    const n = Number(qty);
    if (!n) return;
    try {
      // an adjustment can be + or -; a receipt is +; damaged is always taken out
      const change = kind === "RECEIPT" ? Math.abs(n) : kind === "DAMAGED" ? -Math.abs(n) : n;
      await api.adjustStockFull(part.id, { change, txn_type: kind, reason: reason || undefined, unit_cost: kind === "RECEIPT" && cost ? Number(cost) : undefined, request_id: req });
      setQty(""); setCost(""); setReason(""); setReq(rid()); setOk("Recorded.");
      onDone();
    } catch (e: any) { setErr(e.message); }
  }
  return (
    <div className="space-y-2 bg-panel border border-border rounded-sm p-3 max-w-xl">
      <div className="flex flex-wrap gap-2 items-end">
        <div><label className="text-xs text-muted block mb-1">Type</label>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
            {!isTech && <option value="RECEIPT">Stock received</option>}{!isTech && <option value="ADJUSTMENT">Count correction (+/−)</option>}<option value="DAMAGED">Damaged / scrapped</option></select></div>
        <div><label className="text-xs text-muted block mb-1">Quantity</label><input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm w-24" /></div>
        {kind === "RECEIPT" && <div><label className="text-xs text-muted block mb-1">Unit cost paid</label><input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm w-28" /></div>}
        <div className="flex-1 min-w-[160px]"><label className="text-xs text-muted block mb-1">Reason {kind !== "RECEIPT" && "*"}</label><input value={reason} onChange={(e) => setReason(e.target.value)} className={inp} /></div>
        <button onClick={go} disabled={!Number(qty)} className="text-sm px-3 py-1.5 bg-accent text-white rounded-sm disabled:opacity-50">Record</button>
      </div>
      {err && <div className="text-sm text-bad">{err}</div>}{ok && <div className="text-sm text-good">{ok}</div>}
      <div className="text-xs text-muted">Stock can never go below zero. Large write-offs and corrections need a manager. Parts used on repairs are booked from the work order, not here.</div>
    </div>
  );
}

function Edit({ part, machines, onDone }: { part: SparePart; machines: Machine[]; onDone: () => void }) {
  const [f, setF] = useState({ name: part.name, unit: part.unit, minimum_stock: String(part.minimum_stock), unit_cost: part.unit_cost != null ? String(part.unit_cost) : "",
    storage_location: part.storage_location || "", preferred_vendor: part.preferred_vendor || "", category: part.category || "",
    lead_time_days: part.lead_time_days != null ? String(part.lead_time_days) : "", description: part.description || "",
    machines: part.compatible_machine_ids || [] });
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <div className="bg-panel border border-border rounded-sm p-3 space-y-3 max-w-3xl">
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="text-xs text-muted block mb-1">Name</label><input value={f.name} onChange={(e) => set({ name: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Category</label><input value={f.category} onChange={(e) => set({ category: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Unit</label><input value={f.unit} onChange={(e) => set({ unit: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Minimum stock</label><input type="number" min="0" value={f.minimum_stock} onChange={(e) => set({ minimum_stock: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Unit cost</label><input type="number" min="0" value={f.unit_cost} onChange={(e) => set({ unit_cost: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Lead time (days)</label><input type="number" min="0" value={f.lead_time_days} onChange={(e) => set({ lead_time_days: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Storage location</label><input value={f.storage_location} onChange={(e) => set({ storage_location: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Preferred vendor</label><input value={f.preferred_vendor} onChange={(e) => set({ preferred_vendor: e.target.value })} className={inp} /></div>
      </div>
      <div><label className="text-xs text-muted block mb-1">Fits machines (hold Ctrl / Cmd to pick several)</label>
        <select multiple value={f.machines} onChange={(e) => set({ machines: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${inp} h-28`}>
          {machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number} — {m.machine_name}</option>)}</select></div>
      {err && <div className="text-sm text-bad">{err}</div>}
      <button className="text-sm px-3 py-1.5 bg-accent text-white rounded-sm" onClick={async () => {
        setErr(null);
        try {
          await api.updateSparePart(part.id, {
            name: f.name.trim(), unit: f.unit, minimum_stock: Number(f.minimum_stock) || 0, unit_cost: f.unit_cost !== "" ? Number(f.unit_cost) : undefined,
            storage_location: f.storage_location, preferred_vendor: f.preferred_vendor, category: f.category,
            lead_time_days: f.lead_time_days !== "" ? Number(f.lead_time_days) : undefined, description: f.description, compatible_machine_ids: f.machines,
          });
          onDone();
        } catch (e: any) { setErr(e.message); }
      }}>Save</button>
    </div>
  );
}

function CreateForm({ machines, onDone }: { machines: Machine[]; onDone: () => void }) {
  const [f, setF] = useState({ part_code: "", name: "", category: "", unit: "pcs", minimum_stock: "0", initial_stock: "0", unit_cost: "", storage_location: "", preferred_vendor: "", lead_time_days: "", machines: [] as string[] });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await api.createSparePart({
        part_code: f.part_code.trim(), name: f.name.trim(), category: f.category || undefined, unit: f.unit,
        minimum_stock: Number(f.minimum_stock) || 0, initial_stock: Number(f.initial_stock) || 0,
        unit_cost: f.unit_cost !== "" ? Number(f.unit_cost) : undefined, storage_location: f.storage_location || undefined,
        preferred_vendor: f.preferred_vendor || undefined, lead_time_days: f.lead_time_days !== "" ? Number(f.lead_time_days) : undefined,
        compatible_machine_ids: f.machines,
      });
      onDone();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="kpi-card space-y-3 max-w-3xl">
      <div className="font-medium text-sm">New spare part</div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="text-xs text-muted block mb-1">Part number *</label><input required value={f.part_code} onChange={(e) => set({ part_code: e.target.value })} className={inp} /></div>
        <div className="sm:col-span-2"><label className="text-xs text-muted block mb-1">Name *</label><input required value={f.name} onChange={(e) => set({ name: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Category</label><input value={f.category} onChange={(e) => set({ category: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Unit</label><input value={f.unit} onChange={(e) => set({ unit: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Unit cost</label><input type="number" min="0" value={f.unit_cost} onChange={(e) => set({ unit_cost: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Opening stock</label><input type="number" min="0" value={f.initial_stock} onChange={(e) => set({ initial_stock: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Minimum stock</label><input type="number" min="0" value={f.minimum_stock} onChange={(e) => set({ minimum_stock: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Lead time (days)</label><input type="number" min="0" value={f.lead_time_days} onChange={(e) => set({ lead_time_days: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Storage location</label><input value={f.storage_location} onChange={(e) => set({ storage_location: e.target.value })} className={inp} /></div>
        <div><label className="text-xs text-muted block mb-1">Preferred vendor</label><input value={f.preferred_vendor} onChange={(e) => set({ preferred_vendor: e.target.value })} className={inp} /></div>
      </div>
      <div><label className="text-xs text-muted block mb-1">Fits machines (Ctrl / Cmd to pick several — used for PM stock warnings)</label>
        <select multiple value={f.machines} onChange={(e) => set({ machines: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${inp} h-24`}>
          {machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number} — {m.machine_name}</option>)}</select></div>
      {err && <div className="text-sm text-bad">{err}</div>}
      <button disabled={busy} className="text-sm px-3 py-1.5 bg-accent text-white rounded-sm disabled:opacity-50">{busy ? "Saving…" : "Create part"}</button>
    </form>
  );
}
