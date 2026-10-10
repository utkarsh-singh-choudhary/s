"use client";

import { Fragment, useEffect, useState } from "react";
import { api, AuditLogEntry } from "@/lib/api";

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  async function load(filters?: { entity_type?: string; action?: string; date_from?: string; date_to?: string }) {
    setLoading(true);
    setError(null);
    try {
      setLogs(await api.auditLogs({ limit: 200, ...filters }));
    } catch (e: any) {
      setError(e.message || "Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    api.auditEntityTypes().then(setEntityTypes).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    load({ entity_type: entityType, action, date_from: dateFrom, date_to: dateTo });
  }

  function clearFilters() {
    setEntityType("");
    setAction("");
    setDateFrom("");
    setDateTo("");
    load();
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Audit Log</h1>
        <p className="text-sm text-muted">Who changed what, and when.</p>
      </div>

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted block mb-0.5">Entity type</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="border border-border rounded-sm px-2 py-1 text-xs"
          >
            <option value="">All</option>
            {entityTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted block mb-0.5">Action contains</label>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. UPDATED"
            className="border border-border rounded-sm px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="text-xs text-muted block mb-0.5">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-border rounded-sm px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label className="text-xs text-muted block mb-0.5">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-border rounded-sm px-2 py-1 text-xs"
          />
        </div>
        <button type="submit" className="text-xs px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90">
          Apply
        </button>
        <button type="button" onClick={clearFilters} className="text-xs text-muted hover:underline">
          Clear
        </button>
      </form>

      {error && (
        <div className="text-xs text-bad bg-red-50 border border-red-100 rounded-sm px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="kpi-card text-sm text-muted">No audit entries match these filters.</div>
      ) : (
        <div className="kpi-card !p-0 overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Actor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => {
                const open = openId === l.id;
                const hasDetails = l.old_value != null || l.new_value != null;
                return (
                  <Fragment key={l.id}>
                    <tr>
                      <td className="text-xs">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="text-xs font-medium">{l.action}</td>
                      <td className="text-xs">
                        {l.entity_type} {l.entity_id ? `#${String(l.entity_id).slice(0, 8)}` : ""}
                      </td>
                      <td className="text-xs">
                        {l.actor_name || (l.actor_id ? <span className="font-mono">{l.actor_id.slice(0, 8)}</span> : "—")}
                      </td>
                      <td>
                        {hasDetails && (
                          <button
                            onClick={() => setOpenId(open ? null : l.id)}
                            className="text-xs text-accent hover:underline"
                          >
                            {open ? "Hide" : "Details"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="bg-panel px-4 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <div className="text-xs text-muted mb-1">Before</div>
                              <pre className="text-xs font-mono bg-surface border border-border rounded-sm p-2 overflow-x-auto">
                                {l.old_value != null ? JSON.stringify(l.old_value, null, 2) : "—"}
                              </pre>
                            </div>
                            <div>
                              <div className="text-xs text-muted mb-1">After</div>
                              <pre className="text-xs font-mono bg-surface border border-border rounded-sm p-2 overflow-x-auto">
                                {l.new_value != null ? JSON.stringify(l.new_value, null, 2) : "—"}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
