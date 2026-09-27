import { api } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function EmployeesPage() {
  const employees = await safe(() => api.employees(), []);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Employees</h1>
        <p className="text-sm text-muted">{employees.length} employee{employees.length === 1 ? "" : "s"}.</p>
      </div>

      <div className="kpi-card !p-0 overflow-hidden">
        {employees.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">
            No employees to show — you may need admin access, or the backend isn't reachable.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="font-medium">{e.name}</td>
                  <td>{e.role}</td>
                  <td>{e.department || "—"}</td>
                  <td>{e.email || "—"}</td>
                  <td>{e.phone || "—"}</td>
                  <td><StatusPill status={e.active ? "PLANNED" : "CANCELLED"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
