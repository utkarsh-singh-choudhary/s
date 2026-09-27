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

export default async function BreakdownsPage() {
  const [breakdowns, reliability, machines] = await Promise.all([
    safe(() => api.breakdowns(), []),
    safe(() => api.reliability(), { machines: [] }),
    safe(() => api.machines(), []),
  ]);

  return <BreakdownsClient initialBreakdowns={breakdowns} reliability={reliability.machines} machines={machines} />;
}
