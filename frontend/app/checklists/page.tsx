import { api } from "@/lib/api";
import ChecklistsClient from "./ChecklistsClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function ChecklistsPage() {
  const [templates, machines] = await Promise.all([
    safe(() => api.checklists(true), []), // include inactive; client filters by default
    safe(() => api.machines(true), []),
  ]);

  return <ChecklistsClient initialTemplates={templates} machines={machines} />;
}
