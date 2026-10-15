"use client";

import { useState } from "react";
import { getUser } from "@/lib/auth";
import { api, ChecklistTemplate, ChecklistItemIn, Machine } from "@/lib/api";

type EditState = {
  name: string;
  description: string;
  task_type: string;
  machine_type: string;
  items: ChecklistItemIn[];
};

const TASK_TYPES = ["PM", "INSPECTION", "CORRECTIVE", "BREAKDOWN", "CALIBRATION", "OTHER"];

function cleanItems(items: ChecklistItemIn[]): ChecklistItemIn[] {
  return items
    .filter((i) => i.text.trim())
    .map((i) => ({
      text: i.text.trim(),
      required: i.required ?? true,
      requires_reading: !!i.requires_reading,
      reading_unit: i.requires_reading ? (i.reading_unit || "").trim() || null : null,
      critical: !!i.critical,
      evidence_on_fail: !!i.evidence_on_fail,
    }));
}

function toEditState(t: ChecklistTemplate): EditState {
  return {
    name: t.name,
    description: t.description || "",
    task_type: t.task_type || "PM",
    machine_type: t.machine_type || "",
    items: t.items
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((i) => ({
        text: i.text,
        required: i.required,
        requires_reading: !!i.requires_reading,
        reading_unit: i.reading_unit || "",
        critical: !!i.critical,
        evidence_on_fail: !!i.evidence_on_fail,
      })),
  };
}

export default function ChecklistsClient({
  initialTemplates,
  machines,
}: {
  initialTemplates: ChecklistTemplate[];
  machines: Machine[];
}) {
  const me = getUser();
  const isManager = me?.role === "ADMIN" || me?.role === "MANAGER";

  const [templates, setTemplates] = useState(initialTemplates);
  const [showInactive, setShowInactive] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignMachineId, setAssignMachineId] = useState("");

  const [createForm, setCreateForm] = useState<EditState>({ name: "", description: "", task_type: "PM", machine_type: "", items: [] });

  const visibleTemplates = showInactive ? templates : templates.filter((t) => t.active);

  async function refresh() {
    try {
      setTemplates(await api.checklists(true));
    } catch {
      // keep existing list
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createForm.name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createChecklistTemplate({
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        task_type: createForm.task_type,
        machine_type: createForm.machine_type.trim() || null,
        items: cleanItems(createForm.items),
      });
      setCreateForm({ name: "", description: "", task_type: "PM", machine_type: "", items: [] });
      setShowForm(false);
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to create checklist template");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(t: ChecklistTemplate) {
    setEditingId(t.id);
    setEdit(toEditState(t));
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEdit(null);
  }

  async function saveEdit(id: string) {
    if (!edit) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.updateChecklistTemplate(id, {
        name: edit.name.trim(),
        description: edit.description.trim() || undefined,
        task_type: edit.task_type,
        machine_type: edit.machine_type.trim() || null,
        items: cleanItems(edit.items),
      });
      cancelEdit();
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to update checklist template");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(t: ChecklistTemplate) {
    setSubmitting(true);
    setError(null);
    try {
      if (t.active) {
        await api.deactivateChecklistTemplate(t.id);
      } else {
        await api.restoreChecklistTemplate(t.id);
      }
      await refresh();
    } catch (err: any) {
      setError(err.message || "Failed to update checklist template");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAssign(templateId: string) {
    if (!assignMachineId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.assignChecklistTemplate(templateId, assignMachineId);
      setAssigningId(null);
      setAssignMachineId("");
    } catch (err: any) {
      setError(err.message || "Failed to assign checklist template");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Checklist Templates</h1>
          <p className="text-sm text-muted">
            {visibleTemplates.length} template{visibleTemplates.length === 1 ? "" : "s"}. Assign a template to a
            machine to require sub-step checks when its PM is completed.
          </p>
        </div>
        {isManager && (
          <button onClick={() => setShowForm((v) => !v)} className="text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90">
            {showForm ? "Cancel" : "New template"}
          </button>
        )}
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {isManager && (
        <label className="text-xs flex items-center gap-1.5">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      )}

      {showForm && (
        <form onSubmit={submitCreate} className="kpi-card space-y-3 max-w-lg">
          <div className="font-medium text-sm">New checklist template</div>
          <div>
            <label className="text-xs text-muted block mb-1">Name</label>
            <input
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              required
              className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
              placeholder="e.g. Monthly Lathe Inspection"
            />
          </div>
          <div>
            <label className="text-xs text-muted block mb-1">Description (optional)</label>
            <input
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
            />
          </div>
          <TypeFields state={createForm} setState={setCreateForm} />
          <ItemsEditor state={createForm} setState={setCreateForm} />
          <button type="submit" disabled={submitting} className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50">
            {submitting ? "Creating…" : "Create template"}
          </button>
        </form>
      )}

      {visibleTemplates.length === 0 ? (
        <div className="kpi-card text-sm text-muted">No checklist templates to show.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleTemplates.map((t) => (
            <div key={t.id} className={`kpi-card space-y-2 ${!t.active ? "opacity-60" : ""}`}>
              {editingId === t.id && edit ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted block mb-1">Name</label>
                    <input
                      value={edit.name}
                      onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-1">Description</label>
                    <input
                      value={edit.description}
                      onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                      className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
                    />
                  </div>
                  <TypeFields state={edit} setState={setEdit as (s: EditState) => void} />
                  <p className="text-xs text-muted">Saving changed items creates a new version. Completed PMs keep the version they used.</p>
                  <ItemsEditor state={edit} setState={setEdit as (s: EditState) => void} />
                  <div className="flex gap-2">
                    <button
                      disabled={submitting}
                      onClick={() => saveEdit(t.id)}
                      className="text-xs px-2 py-1 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button onClick={cancelEdit} className="text-xs text-muted hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm">
                        {t.name} {!t.active && <span className="status-pill bg-gray-100 text-muted ml-1">INACTIVE</span>}
                      </div>
                      <div className="text-xs text-muted">
                        {t.task_type || "PM"} · {t.machine_type ? `Machine type: ${t.machine_type}` : "All machine types"} · v{t.version ?? 1}
                      </div>
                      {t.description && <div className="text-xs text-muted">{t.description}</div>}
                    </div>
                  </div>
                  <ol className="text-sm space-y-1 list-decimal list-inside">
                    {t.items
                      .slice()
                      .sort((a, b) => a.sequence - b.sequence)
                      .map((item) => (
                        <li key={item.id}>
                          {item.text}
                          {item.required && <span className="text-bad ml-1">*</span>}
                          {item.requires_reading && <span className="text-xs text-muted ml-1">[reading{item.reading_unit ? ` ${item.reading_unit}` : ""}]</span>}
                          {item.critical && <span className="status-pill bg-red-100 text-bad ml-1">CRITICAL</span>}
                          {item.evidence_on_fail && <span className="text-xs text-muted ml-1">[photo on fail]</span>}
                        </li>
                      ))}
                  </ol>
                  {t.items.length === 0 && <p className="text-xs text-muted">No items yet.</p>}

                  {isManager && (
                    <div className="flex items-center gap-3 border-t border-border mt-2 pt-2">
                      <button onClick={() => startEdit(t)} className="text-xs text-accent hover:underline">
                        Edit
                      </button>
                      <button onClick={() => toggleActive(t)} disabled={submitting} className="text-xs text-muted hover:underline disabled:opacity-50">
                        {t.active ? "Deactivate" : "Restore"}
                      </button>
                      {t.active &&
                        (assigningId === t.id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <select
                              value={assignMachineId}
                              onChange={(e) => setAssignMachineId(e.target.value)}
                              className="border border-border rounded-sm px-1 py-0.5 text-xs"
                            >
                              <option value="">Select machine…</option>
                              {machines.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.machine_number} — {m.machine_name}
                                </option>
                              ))}
                            </select>
                            <button
                              disabled={submitting || !assignMachineId}
                              onClick={() => submitAssign(t.id)}
                              className="text-xs text-good hover:underline disabled:opacity-50"
                            >
                              Assign
                            </button>
                            <button
                              onClick={() => {
                                setAssigningId(null);
                                setAssignMachineId("");
                              }}
                              className="text-xs text-muted hover:underline"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button onClick={() => setAssigningId(t.id)} className="text-xs text-accent hover:underline">
                            Assign to machine
                          </button>
                        ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TypeFields({ state, setState }: { state: EditState; setState: (s: EditState) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="text-xs text-muted block mb-1">Task type</label>
        <select
          value={state.task_type}
          onChange={(e) => setState({ ...state, task_type: e.target.value })}
          className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
        >
          {TASK_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-muted block mb-1">Machine type (blank = all)</label>
        <input
          value={state.machine_type}
          onChange={(e) => setState({ ...state, machine_type: e.target.value })}
          placeholder="e.g. CNC, Compressor"
          className="w-full border border-border rounded-sm px-2 py-1.5 text-sm"
        />
      </div>
    </div>
  );
}

function ItemsEditor({ state, setState }: { state: EditState; setState: (s: EditState) => void }) {
  function patch(idx: number, p: Partial<ChecklistItemIn>) {
    const items = state.items.slice();
    items[idx] = { ...items[idx], ...p };
    setState({ ...state, items });
  }
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted block">Checklist items</label>
      {state.items.map((item, idx) => (
        <div key={idx} className="border border-border rounded-sm p-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <input
              value={item.text}
              onChange={(e) => patch(idx, { text: e.target.value })}
              placeholder={`Step ${idx + 1}`}
              className="flex-1 border border-border rounded-sm px-2 py-1 text-xs"
            />
            <button
              type="button"
              onClick={() => setState({ ...state, items: state.items.filter((_, i) => i !== idx) })}
              className="text-xs text-bad hover:underline"
            >
              Remove
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={item.required ?? true} onChange={(e) => patch(idx, { required: e.target.checked })} />
              Required
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={!!item.critical} onChange={(e) => patch(idx, { critical: e.target.checked })} />
              Critical
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={!!item.evidence_on_fail} onChange={(e) => patch(idx, { evidence_on_fail: e.target.checked })} />
              Photo on fail
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={!!item.requires_reading} onChange={(e) => patch(idx, { requires_reading: e.target.checked })} />
              Needs reading
            </label>
            {item.requires_reading && (
              <input
                value={item.reading_unit || ""}
                onChange={(e) => patch(idx, { reading_unit: e.target.value })}
                placeholder="unit (bar, °C…)"
                className="border border-border rounded-sm px-1.5 py-0.5 w-24"
              />
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setState({ ...state, items: [...state.items, { text: "", required: true }] })}
        className="text-xs text-accent hover:underline"
      >
        + Add item
      </button>
    </div>
  );
}
