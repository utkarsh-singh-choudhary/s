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

export default async function WorkOrdersPage({ searchParams }: { searchParams: { machine_id?: string; status?: string; priority?: string } }) {
  const [machines, people] = await Promise.all([
    safe(() => api.machines(), []),
    safe(() => api.directory(), []),
  ]);
  return (
    <WorkOrdersClient machines={machines} people={people} initialMachineId={searchParams.machine_id || ""}
      initialStatus={searchParams.status || ""} initialPriority={searchParams.priority || ""} />
  );
}
