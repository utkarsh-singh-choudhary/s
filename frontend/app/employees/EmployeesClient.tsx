"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Employee, BulkStatusResult } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";
import { getUser } from "@/lib/auth";

const ROLES = ["ADMIN", "MANAGER", "SUPERVISOR", "TECHNICIAN", "VIEWER"];

const BULK_SKIP_REASON_LABEL: Record<string, string> = {
  not_found: "Employee no longer exists",
  cannot_deactivate_self: "You cannot deactivate your own account",
  already_in_target_state: "Already in that state",
};

type EditState = {
  name: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  role: string;
};

function toEditState(e: Employee): EditState {
  return {
    name: e.name || "",
    email: e.email || "",
    phone: e.phone || "",
    department: e.department || "",
    designation: e.designation || "",
    role: e.role || "TECHNICIAN",
  };
}

export default function EmployeesClient({ initialEmployees }: { initialEmployees: Employee[] }) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkStatusResult | null>(null);

  const me = getUser();
  const isAdmin = me?.role === "ADMIN";

  const selectableEmployees = employees.filter((e) => e.id !== me?.employee_id);
  const allSelected = selectableEmployees.length > 0 && selectableEmployees.every((e) => selected.has(e.id));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableEmployees.map((e) => e.id)));
  }

  async function runBulk(active: boolean) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setError(null);
    setBulkResult(null);
    try {
      const res = await api.bulkSetEmployeeStatus(Array.from(selected), active);
      setBulkResult(res);
      const updatedIds = new Set(res.updated);
      setEmployees((prev) => prev.map((e) => (updatedIds.has(e.id) ? { ...e, active } : e)));
      setSelected(new Set());
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Bulk update failed");
    } finally {
      setBulkBusy(false);
    }
  }

  function startEdit(e: Employee) {
    setError(null);
    setOpenId(e.id);
    setEdit(toEditState(e));
  }

  function cancelEdit() {
    setOpenId(null);
    setEdit(null);
    setError(null);
  }

  async function saveEdit(id: string) {
    if (!edit) return;
    const isSelf = me?.employee_id === id;
    setBusyId(id);
    setError(null);
    try {
      const payload: Record<string, string> = { name: edit.name, phone: edit.phone };
      if (isAdmin) {
        payload.email = edit.email;
        payload.department = edit.department;
        payload.designation = edit.designation;
        payload.role = edit.role;
      }
      const updated = await api.updateEmployee(id, payload as any);
      setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...updated } : e)));
      cancelEdit();
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to update employee");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(e: Employee) {
    setBusyId(e.id);
    setError(null);
    try {
      const res = e.active ? await api.deactivateEmployee(e.id) : await api.activateEmployee(e.id);
      setEmployees((prev) => prev.map((row) => (row.id === e.id ? { ...row, active: res.active } : row)));
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to update status");
    } finally {
      setBusyId(null);
    }
  }

  const canEdit = (e: Employee) => isAdmin || me?.employee_id === e.id;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Employees</h1>
        <p className="text-sm text-muted">{employees.length} employee{employees.length === 1 ? "" : "s"}.</p>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}

      {isAdmin && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-sm border border-border bg-panel px-3 py-2">
          <span className="text-sm text-ink">{selected.size} selected</span>
          <button
            onClick={() => runBulk(true)}
            disabled={bulkBusy}
            className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
          >
            Activate
          </button>
          <button
            onClick={() => runBulk(false)}
            disabled={bulkBusy}
            className="text-sm px-3 py-1.5 rounded-sm border border-border hover:bg-surface disabled:opacity-50"
          >
            Deactivate
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-muted hover:underline">
            Clear selection
          </button>
        </div>
      )}

      {bulkResult && (
        <div className="rounded-sm border border-border bg-panel px-3 py-2 text-sm space-y-1">
          <div className="text-ink">
            {bulkResult.updated.length} updated
            {bulkResult.skipped.length > 0 && `, ${bulkResult.skipped.length} skipped`} of {bulkResult.requested} requested.
          </div>
          {bulkResult.skipped.length > 0 && (
            <ul className="text-xs text-muted list-disc list-inside">
              {bulkResult.skipped.map((s) => (
                <li key={s.id}>
                  {employees.find((e) => e.id === s.id)?.name || s.id.slice(0, 8)} — {BULK_SKIP_REASON_LABEL[s.reason] || s.reason}
                </li>
              ))}
            </ul>
          )}
          <button onClick={() => setBulkResult(null)} className="text-xs text-accent hover:underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="kpi-card !p-0 overflow-hidden">
        {employees.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">
            No employees to show — you may need admin access, or the backend isn't reachable.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                {isAdmin && (
                  <th className="w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                  </th>
                )}
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const open = openId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr>
                      {isAdmin && (
                        <td>
                          {e.id !== me?.employee_id && (
                            <input
                              type="checkbox"
                              checked={selected.has(e.id)}
                              onChange={() => toggleSelected(e.id)}
                              aria-label={`Select ${e.name}`}
                            />
                          )}
                        </td>
                      )}
                      <td className="font-medium">{e.name}</td>
                      <td>{e.role}</td>
                      <td>{e.department || "—"}</td>
                      <td>{e.email || "—"}</td>
                      <td>{e.phone || "—"}</td>
                      <td><StatusPill status={e.active ? "PLANNED" : "CANCELLED"} /></td>
                      <td className="whitespace-nowrap space-x-2">
                        {canEdit(e) && (
                          <button
                            onClick={() => (open ? cancelEdit() : startEdit(e))}
                            className="text-xs text-accent hover:underline"
                          >
                            {open ? "Close" : "Edit"}
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            disabled={busyId === e.id}
                            onClick={() => toggleActive(e)}
                            className="text-xs text-accent hover:underline disabled:opacity-50"
                          >
                            {e.active ? "Deactivate" : "Activate"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && edit && (
                      <tr>
                        <td colSpan={isAdmin ? 8 : 7} className="bg-panel px-4 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            <label className="text-xs space-y-1">
                              <span className="text-muted">Name</span>
                              <input
                                value={edit.name}
                                onChange={(ev) => setEdit({ ...edit, name: ev.target.value })}
                                className="border border-border rounded-sm px-2 py-1 text-sm w-full"
                              />
                            </label>
                            <label className="text-xs space-y-1">
                              <span className="text-muted">Phone</span>
                              <input
                                value={edit.phone}
                                onChange={(ev) => setEdit({ ...edit, phone: ev.target.value })}
                                className="border border-border rounded-sm px-2 py-1 text-sm w-full"
                              />
                            </label>
                            {isAdmin && (
                              <>
                                <label className="text-xs space-y-1">
                                  <span className="text-muted">Email</span>
                                  <input
                                    value={edit.email}
                                    onChange={(ev) => setEdit({ ...edit, email: ev.target.value })}
                                    className="border border-border rounded-sm px-2 py-1 text-sm w-full"
                                  />
                                </label>
                                <label className="text-xs space-y-1">
                                  <span className="text-muted">Department</span>
                                  <input
                                    value={edit.department}
                                    onChange={(ev) => setEdit({ ...edit, department: ev.target.value })}
                                    className="border border-border rounded-sm px-2 py-1 text-sm w-full"
                                  />
                                </label>
                                <label className="text-xs space-y-1">
                                  <span className="text-muted">Designation</span>
                                  <input
                                    value={edit.designation}
                                    onChange={(ev) => setEdit({ ...edit, designation: ev.target.value })}
                                    className="border border-border rounded-sm px-2 py-1 text-sm w-full"
                                  />
                                </label>
                                <label className="text-xs space-y-1">
                                  <span className="text-muted">Role</span>
                                  <select
                                    value={edit.role}
                                    onChange={(ev) => setEdit({ ...edit, role: ev.target.value })}
                                    className="border border-border rounded-sm px-2 py-1 text-sm w-full"
                                  >
                                    {ROLES.map((r) => (
                                      <option key={r} value={r}>{r}</option>
                                    ))}
                                  </select>
                                </label>
                              </>
                            )}
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              disabled={busyId === e.id}
                              onClick={() => saveEdit(e.id)}
                              className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
                            >
                              {busyId === e.id ? "Saving…" : "Save"}
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
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
