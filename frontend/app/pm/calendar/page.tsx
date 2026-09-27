import { api } from "@/lib/api";
import CalendarClient from "./CalendarClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function PMCalendarPage() {
  const [plans, machines] = await Promise.all([
    safe(() => api.pmAll(), []),
    safe(() => api.machines(), []),
  ]);

  return <CalendarClient plans={plans} machines={machines} />;
}
