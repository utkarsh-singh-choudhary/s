import { api } from "@/lib/api";
import MachinesClient from "./MachinesClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function MachinesPage() {
  const [machines, checklists] = await Promise.all([
    safe(() => api.machines(false), []), // all machines (active + archived); client filters by default
    safe(() => api.checklists(), []),
  ]);

  return <MachinesClient machines={machines} checklists={checklists} />;
}
