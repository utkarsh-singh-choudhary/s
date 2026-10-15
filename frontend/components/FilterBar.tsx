"use client";

import { useEffect, useState } from "react";
import { DateField } from "./DateField";
import { fmtDate } from "@/lib/format";

export const DATE_PRESETS = [
  { value: "all", label: "All" },
  { value: "today", label: "Today" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "this_month", label: "This month" },
  { value: "previous_month", label: "Previous month" },
  { value: "this_fy", label: "This FY" },
  { value: "custom", label: "Custom" },
];

export type FilterState = {
  q: string;
  date_preset: string;
  date_from: string;   // ISO
  date_to: string;     // ISO
  date_basis: string;
  sort: string;
  page: number;
  page_size: number;
};

export const defaultFilters = (over: Partial<FilterState> = {}): FilterState => ({
  q: "", date_preset: "all", date_from: "", date_to: "", date_basis: "", sort: "newest", page: 1, page_size: 25, ...over,
});

/** The query-string fields the API understands (custom From/To are only sent with the Custom preset). */
export function filterParams(f: FilterState): Record<string, any> {
  return {
    q: f.q || undefined,
    date_preset: f.date_preset,
    date_from: f.date_preset === "custom" ? f.date_from || undefined : undefined,
    date_to: f.date_preset === "custom" ? f.date_to || undefined : undefined,
    date_basis: f.date_basis || undefined,
    sort: f.sort,
    page: f.page,
    page_size: f.page_size,
  };
}

export function FilterBar({
  value, onChange, basisOptions, sortOptions, canExport, onExport, rangeLabel, children,
}: {
  value: FilterState;
  onChange: (next: FilterState) => void;
  basisOptions?: { value: string; label: string }[];
  sortOptions: { value: string; label: string }[];
  canExport?: boolean;
  onExport?: (format: "csv" | "xlsx") => Promise<void> | void;
  rangeLabel?: { from?: string | null; to?: string | null } | null;
  children?: React.ReactNode;
}) {
  // search is debounced so typing does not fire a request per key
  const [q, setQ] = useState(value.q);
  useEffect(() => setQ(value.q), [value.q]);
  useEffect(() => {
    if (q === value.q) return;
    const t = setTimeout(() => onChange({ ...value, q, page: 1 }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch, page: 1 });

  async function doExport(fmt: "csv" | "xlsx") {
    if (!onExport) return;
    setExporting(true);
    setExportError(null);
    try {
      await onExport(fmt);
    } catch (e: any) {
      setExportError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const customInvalid = value.date_preset === "custom" && value.date_from && value.date_to && value.date_from > value.date_to;

  return (
    <div className="kpi-card !gap-3">
      <div className="flex flex-wrap gap-1.5">
        {DATE_PRESETS.map((p) => (
          <button key={p.value} onClick={() => set({ date_preset: p.value })}
            className={`text-xs px-2.5 py-1 rounded-sm border ${value.date_preset === p.value ? "bg-ink text-white border-ink" : "bg-panel text-muted border-border hover:bg-surface"}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {value.date_preset === "custom" && (
          <>
            <div>
              <label className="text-xs text-muted block mb-1">From</label>
              <DateField value={value.date_from} onChange={(v) => set({ date_from: v })} />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">To</label>
              <DateField value={value.date_to} onChange={(v) => set({ date_to: v })} />
            </div>
          </>
        )}
        {basisOptions && basisOptions.length > 1 && (
          <div>
            <label className="text-xs text-muted block mb-1">Date means</label>
            <select value={value.date_basis || basisOptions[0].value} onChange={(e) => set({ date_basis: e.target.value })}
              className="border border-border rounded-sm px-2 py-1.5 text-sm">
              {basisOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
        )}
        <div className="flex-1 min-w-[180px]">
          <label className="text-xs text-muted block mb-1">Search</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
            className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
        </div>
        {children}
        <div>
          <label className="text-xs text-muted block mb-1">Sort</label>
          <select value={value.sort} onChange={(e) => set({ sort: e.target.value })} className="border border-border rounded-sm px-2 py-1.5 text-sm">
            {sortOptions.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {canExport && onExport && (
          <div className="flex gap-2">
            <button onClick={() => doExport("csv")} disabled={exporting} className="text-sm px-3 py-1.5 border border-border rounded-sm hover:bg-surface disabled:opacity-50">CSV</button>
            <button onClick={() => doExport("xlsx")} disabled={exporting} className="text-sm px-3 py-1.5 border border-border rounded-sm hover:bg-surface disabled:opacity-50">Excel</button>
          </div>
        )}
      </div>

      {customInvalid && <div className="text-xs text-bad">“From” is after “To” — nothing can match.</div>}
      {exportError && <div className="text-xs text-bad">{exportError}</div>}
      {rangeLabel && (rangeLabel.from || rangeLabel.to) && value.date_preset !== "all" && (
        <div className="text-xs text-muted">Showing {fmtDate(rangeLabel.from)} to {fmtDate(rangeLabel.to)}</div>
      )}
    </div>
  );
}
