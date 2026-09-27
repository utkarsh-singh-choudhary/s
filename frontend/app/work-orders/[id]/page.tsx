import { api } from "@/lib/api";
import WorkOrderDetailClient from "./WorkOrderDetailClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function WorkOrderDetailPage({ params }: { params: { id: string } }) {
  const [workOrder, machines, employees, spareParts, consumedParts] = await Promise.all([
    safe(() => api.workOrder(params.id), null),
    safe(() => api.machines(), []),
    safe(() => api.employees(), []),
    safe(() => api.spareParts(), []),
    safe(() => api.workOrderParts(params.id), []),
  ]);

  if (!workOrder) {
    return (
      <div className="p-6">
        <p className="text-sm text-bad">Work order not found.</p>
      </div>
    );
  }

  return (
    <WorkOrderDetailClient
      initialWorkOrder={workOrder}
      machines={machines}
      employees={employees}
      spareParts={spareParts}
      initialConsumedParts={consumedParts}
    />
  );
}
