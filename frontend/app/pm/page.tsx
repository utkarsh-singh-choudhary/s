import Link from "next/link";
import { api } from "@/lib/api";
import PMPlansClient from "./PMPlansClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function PMPlansPage({
  searchParams,
}: {
  searchParams: { status?: string; machine_id?: string };
}) {
  const [machines, employees] = await Promise.all([
    safe(() => api.machines(), []),
    safe(() => api.employees(), []),
  ]);

  return (
    <>
      <div className="px-6 pt-6">
        <Link href="/pm/calendar" className="text-sm text-accent hover:underline">Calendar view →</Link>
      </div>
      <PMPlansClient
        machines={machines}
        employees={employees}
        initialStatus={searchParams.status || ""}
        initialMachineId={searchParams.machine_id || ""}
      />
    </>
  );
}
