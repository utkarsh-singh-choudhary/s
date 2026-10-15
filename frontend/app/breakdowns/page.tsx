import { api } from "@/lib/api";
import BreakdownsClient from "./BreakdownsClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function BreakdownsPage({ searchParams }: { searchParams: { machine_id?: string; status?: string } }) {
  const machines = await safe(() => api.machines(), []);
  return <BreakdownsClient machines={machines} initialMachineId={searchParams.machine_id || ""} initialStatus={searchParams.status || ""} />;
}
