import Link from "next/link";
import { api } from "@/lib/api";
import PMPlansClient from "./PMPlansClient";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  "PLANNED",
  "REMINDER_SENT",
  "DUE",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
  "MISSED",
  "CANCELLED",
  "PENDING_SUPERVISOR_CONFIRMATION",
];

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
  searchParams: { status?: string; page?: string };
}) {
  const status = searchParams.status || "";
  const page = Math.max(1, Number(searchParams.page) || 1);
  const PAGE_SIZE = 30;

  const [plans, machines] = await Promise.all([
    safe(() => api.pmList(status ? { status } : {}), []),
    safe(() => api.machines(), []),
  ]);

  const sorted = [...plans].sort((a, b) => (b.planned_date || "").localeCompare(a.planned_date || ""));
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);
  const statusQuery = status ? `status=${status}&` : "";

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">PM Plans</h1>
        <p className="text-sm text-muted">{plans.length} plan{plans.length === 1 ? "" : "s"}{status ? ` — ${status.replace(/_/g, " ")}` : ""}.</p>
      </div>

      <Link href="/pm/calendar" className="text-sm text-accent hover:underline inline-block">Calendar view →</Link>

      <div className="flex flex-wrap gap-2">
        <FilterLink label="All" active={!status} href="/pm" />
        {STATUS_OPTIONS.map((s) => (
          <FilterLink key={s} label={s.replace(/_/g, " ")} active={status === s} href={`/pm?status=${s}`} />
        ))}
      </div>

      <PMPlansClient rows={pageRows} machines={machines} />

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={clampedPage > 1 ? `/pm?${statusQuery}page=${clampedPage - 1}` : "#"}
            className={`px-2 py-1 rounded-sm border border-border ${clampedPage <= 1 ? "opacity-40 pointer-events-none" : ""}`}
          >
            ← Prev
          </Link>
          <span className="text-muted text-xs">Page {clampedPage} of {totalPages}</span>
          <Link
            href={clampedPage < totalPages ? `/pm?${statusQuery}page=${clampedPage + 1}` : "#"}
            className={`px-2 py-1 rounded-sm border border-border ${clampedPage >= totalPages ? "opacity-40 pointer-events-none" : ""}`}
          >
            Next →
          </Link>
        </div>
      )}
    </div>
  );
}

function FilterLink({ label, active, href }: { label: string; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`text-xs px-2.5 py-1 rounded-sm border ${
        active ? "bg-ink text-white border-ink" : "bg-panel text-muted border-border hover:bg-surface"
      }`}
    >
      {label}
    </Link>
  );
}
