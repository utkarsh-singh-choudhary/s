"use client";

import { Fragment, useState } from "react";
import { getUser } from "@/lib/auth";
import { api, SparePart, SparePartTransaction } from "@/lib/api";

type EditState = {
  name: string;
  unit: string;
  minimum_stock: string;
  unit_cost: string;
  storage_location: string;
  preferred_vendor: string;
  description: string;
};

function toEditState(p: SparePart): EditState {
  return {
    name: p.name,
    unit: p.unit,
    minimum_stock: String(p.minimum_stock),
    unit_cost: p.unit_cost != null ? String(p.unit_cost) : "",
    storage_location: p.storage_location || "",
    preferred_vendor: p.preferred_vendor || "",
    description: p.description || "",
  };
}

export default function SparePartsClient({ initialParts }: { initialParts: SparePart[] }) {
  const [parts, setParts] = useState(initialParts);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<SparePartTransaction[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const me = getUser();
  const canManage = me?.role === "SUPERVISOR" || me?.role === "MANAGER" || me?.role === "ADMIN";

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

  function startEdit(p: SparePart) {
    setEditingId(p.id);
    setEditState(toEditState(p));
    setHistoryId(null);
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState(null);
  }

  async function saveEdit(id: string) {
    if (!editState) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.updateSparePart(id, {
        name: editState.name.trim(),
        unit: editState.unit,
        minimum_stock: Number(editState.minimum_stock) || 0,
        unit_cost: editState.unit_cost !== "" ? Number(editState.unit_cost) : undefined,
        storage_location: editState.storage_location,
        preferred_vendor: editState.preferred_vendor,
        description: editState.description,
      });
      cancelEdit();
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to update spare part");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleHistory(id: string) {
    if (historyId === id) {
      setHistoryId(null);
      return;
    }
    setHistoryId(id);
    setEditingId(null);
    setHistory([]);
    setHistoryLoading(true);
    try {
      setHistory(await api.sparePartTransactions(id));
    } catch (err: any) {
      setError(err.message || "Failed to load stock history");
    } finally {
      setHistoryLoading(false);
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
                <Fragment key={p.id}>
                <tr>
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
                    {canManage && (
                      <button onClick={() => (editingId === p.id ? cancelEdit() : startEdit(p))} className="text-xs text-accent hover:underline ml-2">
                        {editingId === p.id ? "Close" : "Edit"}
                      </button>
                    )}
                    <button onClick={() => toggleHistory(p.id)} className="text-xs text-muted hover:underline ml-2">
                      {historyId === p.id ? "Hide history" : "History"}
                    </button>
                  </td>
                </tr>
                {editingId === p.id && editState && (
                  <tr>
                    <td colSpan={8} className="bg-panel px-4 py-3">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <label className="text-xs space-y-1">
                          <span className="text-muted">Name</span>
                          <input value={editState.name} onChange={(ev) => setEditState({ ...editState, name: ev.target.value })}
                            className="border border-border rounded-sm px-2 py-1 text-sm w-full" />
                        </label>
                        <label className="text-xs space-y-1">
                          <span className="text-muted">Unit</span>
                          <select value={editState.unit} onChange={(ev) => setEditState({ ...editState, unit: ev.target.value })}
                            className="border border-border rounded-sm px-2 py-1 text-sm w-full">
                            {["pcs", "ltr", "kg", "mtr"].map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs space-y-1">
                          <span className="text-muted">Minimum stock</span>
                          <input type="number" min={0} value={editState.minimum_stock}
                            onChange={(ev) => setEditState({ ...editState, minimum_stock: ev.target.value })}
                            className="border border-border rounded-sm px-2 py-1 text-sm w-full" />
                        </label>
                        <label className="text-xs space-y-1">
                          <span className="text-muted">Unit cost</span>
                          <input type="number" min={0} value={editState.unit_cost}
                            onChange={(ev) => setEditState({ ...editState, unit_cost: ev.target.value })}
                            className="border border-border rounded-sm px-2 py-1 text-sm w-full" />
                        </label>
                        <label className="text-xs space-y-1">
                          <span className="text-muted">Storage location</span>
                          <input value={editState.storage_location}
                            onChange={(ev) => setEditState({ ...editState, storage_location: ev.target.value })}
                            className="border border-border rounded-sm px-2 py-1 text-sm w-full" />
                        </label>
                        <label className="text-xs space-y-1">
                          <span className="text-muted">Preferred vendor</span>
                          <input value={editState.preferred_vendor}
                            onChange={(ev) => setEditState({ ...editState, preferred_vendor: ev.target.value })}
                            className="border border-border rounded-sm px-2 py-1 text-sm w-full" />
                        </label>
                        <label className="text-xs space-y-1 col-span-2 md:col-span-3">
                          <span className="text-muted">Description</span>
                          <input value={editState.description}
                            onChange={(ev) => setEditState({ ...editState, description: ev.target.value })}
                            className="border border-border rounded-sm px-2 py-1 text-sm w-full" />
                        </label>
                      </div>
                      <p className="text-xs text-muted mt-2">Stock quantity changes only via "Adjust stock", so the history stays accurate.</p>
                      <div className="mt-3 flex gap-2">
                        <button disabled={submitting} onClick={() => saveEdit(p.id)}
                          className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
                          {submitting ? "Saving…" : "Save"}
                        </button>
                        <button onClick={cancelEdit} className="text-sm px-3 py-1.5 rounded-sm border border-border">Cancel</button>
                      </div>
                    </td>
                  </tr>
                )}
                {historyId === p.id && (
                  <tr>
                    <td colSpan={8} className="bg-panel px-4 py-3">
                      {historyLoading ? (
                        <div className="text-xs text-muted">Loading…</div>
                      ) : history.length === 0 ? (
                        <div className="text-xs text-muted">No stock movements recorded.</div>
                      ) : (
                        <table className="data-table">
                          <thead>
                            <tr><th>Date</th><th>Change</th><th>Reason</th><th>By</th></tr>
                          </thead>
                          <tbody>
                            {history.map((t) => (
                              <tr key={t.id}>
                                <td className="text-xs">{new Date(t.created_at).toLocaleString()}</td>
                                <td className={`text-xs font-medium ${t.change < 0 ? "text-bad" : "text-good"}`}>
                                  {t.change > 0 ? `+${t.change}` : t.change}
                                </td>
                                <td className="text-xs">{t.reason || "—"}</td>
                                <td className="text-xs">{t.performed_by_name || "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
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
