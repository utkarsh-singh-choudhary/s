"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import {
  api, BreakdownRow, BreakdownSummary, FAILURE_CATEGORIES, IMPACTS, Machine, Paged, SEVERITIES,
} from "@/lib/api";
import { defaultFilters, FilterBar, filterParams, FilterState } from "@/components/FilterBar";
import { Pagination } from "@/components/Pagination";
import { Pill } from "@/components/Pill";
import { KpiCard } from "@/components/KpiCard";
import { fmtDateTime, fmtMinutes, localInputToApi, nowLocalInput } from "@/lib/format";

const STATUSES = ["REPORTED", "UNDER_DIAGNOSIS", "REPAIR_IN_PROGRESS", "AWAITING_VERIFICATION", "RESTORED", "CLOSED"];

export default function BreakdownsClient({
  machines, initialMachineId, initialStatus,
}: { machines: Machine[]; initialMachineId: string; initialStatus: string }) {
  const [filters, setFilters] = useState<FilterState>(defaultFilters({ date_basis: "incident" }));
  const [status, setStatus] = useState(initialStatus);
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [machineId, setMachineId] = useState(initialMachineId);
  const [openOnly, setOpenOnly] = useState(false);
  const [data, setData] = useState<Paged<BreakdownRow, BreakdownSummary> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<string | undefined>();

  const [showForm, setShowForm] = useState(false);
  const extra = { status, severity, category, machine_id: machineId, open_only: openOnly };
  const params = { ...filterParams(filters), ...extra };

  useEffect(() => setRole(getUser()?.role), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.searchBreakdowns(params));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params)]);

  useEffect(() => { load(); }, [load]);

  const canExport = role === "ADMIN" || role === "MANAGER" || role === "SUPERVISOR";
  const canReport = !!role && role !== "VIEWER";
  const s = data?.summary;
  const reset = (patch: () => void) => { patch(); setFilters((f) => ({ ...f, page: 1 })); };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-ink">Breakdowns</h1>
          <p className="text-sm text-muted">Every incident from report to root cause, corrective action and closure.</p>
        </div>
        {canReport && (
          <button onClick={() => setShowForm((v) => !v)} className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90">
            {showForm ? "Cancel" : "Report breakdown"}
          </button>
        )}
      </div>

      {showForm && <ReportForm machines={machines} defaultMachine={machineId} onDone={() => { setShowForm(false); load(); }} />}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <KpiCard label="Matching" value={s?.total ?? "—"} />
        <KpiCard label="Machine still down" value={s?.open ?? "—"} tone={s && s.open > 0 ? "bad" : undefined} />
        <KpiCard label="Restored" value={s?.restored ?? "—"} />
        <KpiCard label="Closed" value={s?.closed ?? "—"} />
        <KpiCard label="Repeat failures" value={s?.recurring ?? "—"} tone={s && s.recurring > 0 ? "warn" : undefined} />
        <KpiCard label="Downtime" value={s ? `${s.downtime_hours} h` : "—"} />
      </div>

      <FilterBar
        value={filters}
        onChange={setFilters}
        basisOptions={[
          { value: "incident", label: "Incident (breakdown) date" },
          { value: "restored", label: "Restoration date" },
          { value: "closed", label: "Closed date" },
        ]}
        sortOptions={[
          { value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" },
          { value: "downtime", label: "Longest downtime" }, { value: "severity", label: "Severity" },
          { value: "machine", label: "Machine" },
        ]}
        canExport={canExport}
        onExport={(fmt) => api.exportBreakdowns({ ...filterParams(filters), ...extra, page: undefined, page_size: undefined }, fmt)}
        rangeLabel={data?.range}
      >
        <Select label="Status" value={status} onChange={(v) => reset(() => setStatus(v))} options={STATUSES} />
        <Select label="Severity" value={severity} onChange={(v) => reset(() => setSeverity(v))} options={[...SEVERITIES]} />
        <Select label="Category" value={category} onChange={(v) => reset(() => setCategory(v))} options={[...FAILURE_CATEGORIES]} />
        <div>
          <label className="text-xs text-muted block mb-1">Machine</label>
          <select value={machineId} onChange={(e) => reset(() => setMachineId(e.target.value))} className="border border-border rounded-sm px-2 py-1.5 text-sm max-w-[180px]">
            <option value="">All</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number}</option>)}
          </select>
        </div>
        <label className="text-sm flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={openOnly} onChange={(e) => reset(() => setOpenOnly(e.target.checked))} /> Still down
        </label>
      </FilterBar>

      {error && <div className="text-sm text-bad">{error}</div>}

      <div className={`kpi-card !p-0 overflow-x-auto ${loading ? "opacity-60" : ""}`}>
        {data && data.items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No breakdowns match these filters.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Machine</th><th>Breakdown time</th><th>Failure</th><th>Severity</th>
                <th>Status</th><th>Root cause</th><th>Downtime</th><th>Restored</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items || []).map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-xs whitespace-nowrap">
                    <Link href={`/breakdowns/${b.id}`} className="text-accent hover:underline">{b.bd_number || b.id.slice(0, 8)}</Link>
                    {b.recurring && <span className="ml-1 status-pill bg-amber-50 text-amber-800" title="Repeat failure">repeat</span>}
                  </td>
                  <td>
                    <Link href={`/machines/${b.machine_id}`} className="hover:underline">{b.machine_number}</Link>
                    <div className="text-xs text-muted">{b.machine_name}</div>
                  </td>
                  <td className="whitespace-nowrap">{fmtDateTime(b.breakdown_at)}</td>
                  <td>
                    <div>{b.failure_mode || b.cause || "—"}</div>
                    <div className="text-xs text-muted">{b.failure_category ? b.failure_category : ""}</div>
                  </td>
                  <td><Pill value={b.severity} /></td>
                  <td><Pill value={b.status} /></td>
                  <td className="text-xs">
                    {b.root_cause ? <><div className="max-w-[200px] truncate" title={b.root_cause}>{b.root_cause}</div><Pill value={b.rca_status} /></> : <Pill value={b.rca_status} />}
                  </td>
                  <td className="whitespace-nowrap">{fmtMinutes(b.downtime_minutes)}{b.is_open && <span className="text-bad text-xs"> (ongoing)</span>}</td>
                  <td className="whitespace-nowrap">{b.resumed_at ? fmtDateTime(b.resumed_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.page_size}
          onPage={(p) => setFilters((f) => ({ ...f, page: p }))}
          onPageSize={(n) => setFilters((f) => ({ ...f, page_size: n, page: 1 }))} />
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-xs text-muted block mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-border rounded-sm px-2 py-1.5 text-sm">
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
      </select>
    </div>
  );
}

function ReportForm({ machines, defaultMachine, onDone }: { machines: Machine[]; defaultMachine: string; onDone: () => void }) {
  const [machineId, setMachineId] = useState(defaultMachine || machines[0]?.id || "");
  const [at, setAt] = useState(nowLocalInput());
  const [category, setCategory] = useState("");
  const [mode, setMode] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const [impact, setImpact] = useState("STOPPED");
  const [symptom, setSymptom] = useState("");
  const [temp, setTemp] = useState("");
  const [makeWo, setMakeWo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; number: string } | null>(null);

  async function submit(e: React.FormEvent, force = false) {
    e.preventDefault();
    if (!machineId) return;
    setBusy(true); setError(null); setExisting(null);
    try {
      const r = await api.reportBreakdownFull({
        machine_id: machineId, breakdown_at: localInputToApi(at), failure_category: category || undefined,
        failure_mode: mode.trim() || undefined, severity, production_impact: impact || undefined,
        cause: symptom.trim() || undefined, temporary_action: temp.trim() || undefined,
        create_work_order: makeWo, force,
      });
      window.location.href = `/breakdowns/${r.id}`;
      onDone();
    } catch (err: any) {
      setError(err.message);
      // the server tells us which incident is already open for this machine
      const m = /\((BD-[\d-]+)\)/.exec(err.message || "");
      if (m) setExisting({ id: "", number: m[1] });
    } finally {
      setBusy(false);
    }
  }

  const inp = "w-full border border-border rounded-sm px-2 py-1.5 text-sm";
  return (
    <form onSubmit={submit} className="kpi-card space-y-3 max-w-3xl">
      <div className="font-medium text-sm">Report a breakdown</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted block mb-1">Machine *</label>
          <select value={machineId} onChange={(e) => setMachineId(e.target.value)} className={inp} required>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.machine_number} — {m.machine_name}{m.critical ? " ★" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">When did it stop? *</label>
          <input type="datetime-local" value={at} max={nowLocalInput()} onChange={(e) => setAt(e.target.value)} className={inp} required />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Severity *</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inp}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Production impact</label>
          <select value={impact} onChange={(e) => setImpact(e.target.value)} className={inp}>
            {IMPACTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Failure category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inp}>
            <option value="">Not sure yet</option>
            {FAILURE_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">Failure mode (what failed)</label>
          <input value={mode} onChange={(e) => setMode(e.target.value)} placeholder="e.g. Bearing seized" className={inp} />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted block mb-1">What was seen / heard (symptom)</label>
        <textarea value={symptom} onChange={(e) => setSymptom(e.target.value)} rows={2} className={inp} placeholder="Observation only — the root cause is investigated later" />
      </div>
      <div>
        <label className="text-xs text-muted block mb-1">Temporary action taken (if any)</label>
        <input value={temp} onChange={(e) => setTemp(e.target.value)} className={inp} />
      </div>
      <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={makeWo} onChange={(e) => setMakeWo(e.target.checked)} /> Also create a repair work order</label>
      {error && (
        <div className="text-sm text-bad space-y-1">
          <div>{error}</div>
          {existing && (
            <button type="button" onClick={(e) => submit(e as any, true)} className="text-accent underline text-xs">
              This is a separate failure — report it anyway
            </button>
          )}
        </div>
      )}
      <button type="submit" disabled={busy} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
        {busy ? "Saving…" : "Report breakdown"}
      </button>
    </form>
  );
}
