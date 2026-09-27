"use client";

import { useState } from "react";
import { api, SparePart } from "@/lib/api";

export default function SparePartsClient({ initialParts }: { initialParts: SparePart[] }) {
  const [parts, setParts] = useState(initialParts);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);

  const [partCode, setPartCode] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("pcs");
  const [minStock, setMinStock] = useState("0");
  const [initialStock, setInitialStock] = useState("0");
  const [location, setLocation] = useState("");

  const visibleParts = lowStockOnly ? parts.filter((p) => p.low_stock) : parts;
  const lowStockCount = parts.filter((p) => p.low_stock).length;

  async function refresh() {
    try {
      setParts(await api.spareParts());
    } catch {
      // keep existing list
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!partCode.trim() || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createSparePart({
        part_code: partCode.trim(),
        name: name.trim(),
        unit,
        minimum_stock: Number(minStock) || 0,
        initial_stock: Number(initialStock) || 0,
        storage_location: location || undefined,
      });
      setPartCode("");
      setName("");
      setMinStock("0");
      setInitialStock("0");
      setLocation("");
      setShowForm(false);
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to create spare part");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAdjust(id: string, change: number, reason: string) {
    setSubmitting(true);
    setError(null);
    try {
      await api.adjustStock(id, { change, reason: reason || undefined });
      setAdjustingId(null);
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to adjust stock");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Spare Parts</h1>
          <p className="text-sm text-muted">
            {parts.length} parts, <span className={lowStockCount ? "text-bad" : ""}>{lowStockCount} low stock</span>.
          </p>
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90">
          {showForm ? "Cancel" : "Add part"}
        </button>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {showForm && (
        <form onSubmit={submitCreate} className="kpi-card space-y-3 max-w-lg">
          <div className="font-medium text-sm">New spare part</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Part code</label>
              <input value={partCode} onChange={(e) => setPartCode(e.target.value)} required className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" placeholder="e.g. BRG-6205" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Unit</label>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm">
                <option value="pcs">pcs</option>
                <option value="ltr">ltr</option>
                <option value="kg">kg</option>
                <option value="mtr">mtr</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" placeholder="e.g. Bearing 6205" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted block mb-1">Minimum stock</label>
              <input type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Initial stock</label>
              <input type="number" min={0} value={initialStock} onChange={(e) => setInitialStock(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Storage location (optional)</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full border border-border rounded-sm px-2 py-1.5 text-sm" />
          </div>
          <button type="submit" disabled={submitting} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
            {submitting ? "Creating…" : "Create part"}
          </button>
        </form>
      )}

      <label className="text-xs flex items-center gap-1.5">
        <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
        Low stock only
      </label>

      <div className="kpi-card !p-0 overflow-hidden">
        {visibleParts.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">No parts to show.</div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>On hand</th>
                <th>Reserved</th>
                <th>Available</th>
                <th>Minimum</th>
                <th>Location</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleParts.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.part_code}</td>
                  <td>{p.name}</td>
                  <td className={p.low_stock ? "text-bad font-medium" : ""}>{p.stock_on_hand} {p.unit}</td>
                  <td>{p.reserved_stock}</td>
                  <td>{p.available_stock}</td>
                  <td>{p.minimum_stock}</td>
                  <td>{p.storage_location || "—"}</td>
                  <td>
                    {p.low_stock && <span className="status-pill bg-red-50 text-bad mr-2">LOW STOCK</span>}
                    {adjustingId === p.id ? (
                      <AdjustInline
                        submitting={submitting}
                        onCancel={() => setAdjustingId(null)}
                        onSubmit={(change, reason) => submitAdjust(p.id, change, reason)}
                      />
                    ) : (
                      <button onClick={() => setAdjustingId(p.id)} className="text-xs text-accent hover:underline">
                        Adjust stock
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AdjustInline({
  submitting,
  onCancel,
  onSubmit,
}: {
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (change: number, reason: string) => void;
}) {
  const [amount, setAmount] = useState("1");
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [reason, setReason] = useState("");

  return (
    <div className="inline-flex items-center gap-1.5">
      <select value={direction} onChange={(e) => setDirection(e.target.value as "in" | "out")} className="border border-border rounded-sm px-1 py-0.5 text-xs">
        <option value="in">Receive</option>
        <option value="out">Consume</option>
      </select>
      <input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="border border-border rounded-sm px-1.5 py-0.5 text-xs w-16"
      />
      <input
        placeholder="Reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="border border-border rounded-sm px-1.5 py-0.5 text-xs w-28"
      />
      <button
        disabled={submitting}
        onClick={() => onSubmit(direction === "in" ? Number(amount) : -Number(amount), reason)}
        className="text-xs text-good hover:underline disabled:opacity-50"
      >
        Save
      </button>
      <button onClick={onCancel} className="text-xs text-muted hover:underline">
        Cancel
      </button>
    </div>
  );
}
