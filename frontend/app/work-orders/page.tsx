import { api } from "@/lib/api";
import WorkOrdersClient from "./WorkOrdersClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function WorkOrdersPage({ searchParams }: { searchParams: { machine_id?: string } }) {
  const machineId = searchParams.machine_id;
  const [workOrders, machines, employees] = await Promise.all([
    safe(() => api.workOrders(machineId ? { machine_id: machineId } : {}), []),
    safe(() => api.machines(), []),
    safe(() => api.employees(), []),
  ]);

  return <WorkOrdersClient initialWorkOrders={workOrders} machines={machines} employees={employees} machineFilterId={machineId} />;
}
