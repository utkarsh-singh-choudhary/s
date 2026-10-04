import { api } from "@/lib/api";
import EmployeesClient from "./EmployeesClient";

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
  return <EmployeesClient initialEmployees={employees} />;
}
