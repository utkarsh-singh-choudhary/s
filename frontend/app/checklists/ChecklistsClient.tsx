"use client";

import { useState } from "react";
import { getUser } from "@/lib/auth";
import { api, ChecklistTemplate, ChecklistItemIn, Machine } from "@/lib/api";

type EditState = {
  name: string;
  description: string;
  items: ChecklistItemIn[];
};

function toEditState(t: ChecklistTemplate): EditState {
  return {
    name: t.name,
    description: t.description || "",
    items: t.items
      .slice()
      .sort((a, b) => a.sequence - b.sequence)
      .map((i) => ({ text: i.text, required: i.required })),
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

  const [createForm, setCreateForm] = useState<EditState>({ name: "", description: "", items: [] });

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
        items: createForm.items.filter((i) => i.text.trim()).map((i) => ({ text: i.text.trim(), required: i.required ?? true })),
      });
      setCreateForm({ name: "", description: "", items: [] });
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
        items: edit.items.filter((i) => i.text.trim()).map((i) => ({ text: i.text.trim(), required: i.required ?? true })),
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

function ItemsEditor({ state, setState }: { state: EditState; setState: (s: EditState) => void }) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted block">Checklist items</label>
      {state.items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5">
          <input
            value={item.text}
            onChange={(e) => {
              const items = state.items.slice();
              items[idx] = { ...items[idx], text: e.target.value };
              setState({ ...state, items });
            }}
            placeholder={`Step ${idx + 1}`}
            className="flex-1 border border-border rounded-sm px-2 py-1 text-xs"
          />
          <label className="text-xs text-muted flex items-center gap-1 whitespace-nowrap">
            <input
              type="checkbox"
              checked={item.required ?? true}
              onChange={(e) => {
                const items = state.items.slice();
                items[idx] = { ...items[idx], required: e.target.checked };
                setState({ ...state, items });
              }}
            />
            Required
          </label>
          <button
            type="button"
            onClick={() => setState({ ...state, items: state.items.filter((_, i) => i !== idx) })}
            className="text-xs text-bad hover:underline"
          >
            Remove
          </button>
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
