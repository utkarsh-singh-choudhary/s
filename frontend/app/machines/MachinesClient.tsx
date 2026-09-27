"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Machine } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";

const PAGE_SIZE = 25;

export default function MachinesClient({ machines }: { machines: Machine[] }) {
  const [search, setSearch] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return machines.filter((m) => {
      if (criticalOnly && !m.critical) return false;
      if (!q) return true;
      return (
        m.machine_number.toLowerCase().includes(q) ||
        m.machine_name.toLowerCase().includes(q) ||
        (m.location || "").toLowerCase().includes(q) ||
        (m.manufacturer || "").toLowerCase().includes(q)
      );
    });
  }, [machines, search, criticalOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Machines</h1>
        <p className="text-sm text-muted">{machines.length} active machines.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search number, name, location, manufacturer…"
          className="border border-border rounded-sm px-3 py-1.5 text-sm w-72"
        />
        <label className="text-xs flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={criticalOnly}
            onChange={(e) => {
              setCriticalOnly(e.target.checked);
              setPage(1);
            }}
          />
          Critical only
        </label>
        <span className="text-xs text-muted">{filtered.length} match{filtered.length === 1 ? "" : "es"}</span>
      </div>

      <div className="kpi-card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>M/c No.</th>
              <th>Name</th>
              <th>Manufacturer</th>
              <th>Location</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">
                  <Link href={`/machines/${m.id}`} className="text-accent hover:underline">
                    {m.machine_number}
                  </Link>
                </td>
                <td>{m.machine_name} {m.critical && <span className="text-bad">*</span>}</td>
                <td>{m.manufacturer || "—"}</td>
                <td>{m.location || "—"}</td>
                <td><StatusPill status={m.active ? "PLANNED" : "CANCELLED"} /></td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">No machines match your search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button
            disabled={clampedPage <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-2 py-1 rounded-sm border border-border disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-muted text-xs">Page {clampedPage} of {totalPages}</span>
          <button
            disabled={clampedPage >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-2 py-1 rounded-sm border border-border disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
