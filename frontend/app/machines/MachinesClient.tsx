"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, Machine, ChecklistTemplate, MachineIn } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { getUser } from "@/lib/auth";

const PAGE_SIZE = 25;

type FormState = {
  machine_number: string;
  machine_name: string;
  manufacturer: string;
  specification: string;
  location: string;
  remarks: string;
  critical: boolean;
  checklist_template_id: string;
};

const EMPTY_FORM: FormState = {
  machine_number: "",
  machine_name: "",
  manufacturer: "",
  specification: "",
  location: "",
  remarks: "",
  critical: false,
  checklist_template_id: "",
};

function toFormState(m: Machine): FormState {
  return {
    machine_number: m.machine_number,
    machine_name: m.machine_name,
    manufacturer: m.manufacturer || "",
    specification: m.specification || "",
    location: m.location || "",
    remarks: m.remarks || "",
    critical: m.critical,
    checklist_template_id: m.checklist_template_id || "",
  };
}

function toPayload(f: FormState): MachineIn {
  return {
    machine_number: f.machine_number,
    machine_name: f.machine_name,
    manufacturer: f.manufacturer || undefined,
    specification: f.specification || undefined,
    location: f.location || undefined,
    remarks: f.remarks || undefined,
    critical: f.critical,
    checklist_template_id: f.checklist_template_id || null,
  };
}

export default function MachinesClient({ machines, checklists }: { machines: Machine[]; checklists: ChecklistTemplate[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(machines);
  const [search, setSearch] = useState("");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const me = getUser();
  const canManage = me?.role === "ADMIN" || me?.role === "MANAGER";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((m) => {
      if (!showArchived && !m.active) return false;
      if (criticalOnly && !m.critical) return false;
      if (!q) return true;
      return (
        m.machine_number.toLowerCase().includes(q) ||
        m.machine_name.toLowerCase().includes(q) ||
        (m.location || "").toLowerCase().includes(q) ||
        (m.manufacturer || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, criticalOnly, showArchived]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);
  const activeCount = rows.filter((m) => m.active).length;

  function startCreate() {
    setError(null);
    setEditId(null);
    setEditForm(null);
    setCreateForm(EMPTY_FORM);
    setCreating(true);
  }

  async function submitCreate() {
    setBusyId("__create__");
    setError(null);
    try {
      const created = await api.createMachine(toPayload(createForm));
      setRows((prev) => [...prev, created]);
      setCreating(false);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to create machine");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(m: Machine) {
    setError(null);
    setCreating(false);
    setEditId(m.id);
    setEditForm(toFormState(m));
  }

  function cancelEdit() {
    setEditId(null);
    setEditForm(null);
    setError(null);
  }

  async function submitEdit(id: string) {
    if (!editForm) return;
    setBusyId(id);
    setError(null);
    try {
      const updated = await api.updateMachine(id, toPayload(editForm));
      setRows((prev) => prev.map((m) => (m.id === id ? { ...m, ...updated } : m)));
      cancelEdit();
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to update machine");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleArchive(m: Machine) {
    setBusyId(m.id);
    setError(null);
    try {
      const updated = m.active ? await api.archiveMachine(m.id) : await api.restoreMachine(m.id);
      setRows((prev) => prev.map((row) => (row.id === m.id ? { ...row, ...updated } : row)));
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to update machine status");
    } finally {
      setBusyId(null);
    }
  }

  function renderFormFields(form: FormState, setForm: (f: FormState) => void) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="text-xs space-y-1">
          <span className="text-muted">M/c Number</span>
          <input
            value={form.machine_number}
            onChange={(e) => setForm({ ...form, machine_number: e.target.value })}
            className="border border-border rounded-sm px-2 py-1 text-sm w-full"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted">Name</span>
          <input
            value={form.machine_name}
            onChange={(e) => setForm({ ...form, machine_name: e.target.value })}
            className="border border-border rounded-sm px-2 py-1 text-sm w-full"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted">Manufacturer</span>
          <input
            value={form.manufacturer}
            onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
            className="border border-border rounded-sm px-2 py-1 text-sm w-full"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted">Location</span>
          <input
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="border border-border rounded-sm px-2 py-1 text-sm w-full"
          />
        </label>
        <label className="text-xs space-y-1 md:col-span-2">
          <span className="text-muted">Specification</span>
          <input
            value={form.specification}
            onChange={(e) => setForm({ ...form, specification: e.target.value })}
            className="border border-border rounded-sm px-2 py-1 text-sm w-full"
          />
        </label>
        <label className="text-xs space-y-1 md:col-span-3">
          <span className="text-muted">Remarks</span>
          <input
            value={form.remarks}
            onChange={(e) => setForm({ ...form, remarks: e.target.value })}
            className="border border-border rounded-sm px-2 py-1 text-sm w-full"
          />
        </label>
        <label className="text-xs space-y-1">
          <span className="text-muted">Checklist template</span>
          <select
            value={form.checklist_template_id}
            onChange={(e) => setForm({ ...form, checklist_template_id: e.target.value })}
            className="border border-border rounded-sm px-2 py-1 text-sm w-full"
          >
            <option value="">None</option>
            {checklists.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs flex items-center gap-1.5 self-end pb-1">
          <input
            type="checkbox"
            checked={form.critical}
            onChange={(e) => setForm({ ...form, critical: e.target.checked })}
          />
          Critical machine
        </label>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">Machines</h1>
          <p className="text-sm text-muted">{activeCount} active machine{activeCount === 1 ? "" : "s"}.</p>
        </div>
        {canManage && !creating && (
          <button
            onClick={startCreate}
            className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90"
          >
            + Add Machine
          </button>
        )}
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {creating && (
        <div className="kpi-card space-y-3">
          <h2 className="text-sm font-medium text-ink">New machine</h2>
          {renderFormFields(createForm, setCreateForm)}
          <div className="flex gap-2">
            <button
              disabled={busyId === "__create__"}
              onClick={submitCreate}
              className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
            >
              {busyId === "__create__" ? "Creating…" : "Create"}
            </button>
            <button onClick={() => setCreating(false)} className="text-sm px-3 py-1.5 rounded-sm border border-border">
              Cancel
            </button>
          </div>
        </div>
      )}

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
        {canManage && (
          <label className="text-xs flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => {
                setShowArchived(e.target.checked);
                setPage(1);
              }}
            />
            Show archived
          </label>
        )}
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
              {canManage && <th></th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((m) => {
              const open = editId === m.id;
              return (
                <Fragment key={m.id}>
                  <tr>
                    <td className="font-medium">
                      <Link href={`/machines/${m.id}`} className="text-accent hover:underline">
                        {m.machine_number}
                      </Link>
                    </td>
                    <td>{m.machine_name} {m.critical && <span className="text-bad">*</span>}</td>
                    <td>{m.manufacturer || "—"}</td>
                    <td>{m.location || "—"}</td>
                    <td><StatusPill status={m.active ? "PLANNED" : "CANCELLED"} /></td>
                    {canManage && (
                      <td className="whitespace-nowrap space-x-2">
                        <button
                          onClick={() => (open ? cancelEdit() : startEdit(m))}
                          className="text-xs text-accent hover:underline"
                        >
                          {open ? "Close" : "Edit"}
                        </button>
                        <button
                          disabled={busyId === m.id}
                          onClick={() => toggleArchive(m)}
                          className="text-xs text-accent hover:underline disabled:opacity-50"
                        >
                          {m.active ? "Archive" : "Restore"}
                        </button>
                      </td>
                    )}
                  </tr>
                  {open && editForm && (
                    <tr>
                      <td colSpan={canManage ? 6 : 5} className="bg-panel px-4 py-3">
                        {renderFormFields(editForm, setEditForm)}
                        <div className="mt-3 flex gap-2">
                          <button
                            disabled={busyId === m.id}
                            onClick={() => submitEdit(m.id)}
                            className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {busyId === m.id ? "Saving…" : "Save"}
                          </button>
                          <button onClick={cancelEdit} className="text-sm px-3 py-1.5 rounded-sm border border-border">
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="px-3 py-6 text-center text-muted">No machines match your search.</td>
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
