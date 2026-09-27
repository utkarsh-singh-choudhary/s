"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Machine, PMPlan, WorkOrder } from "@/lib/api";
import { getUser } from "@/lib/auth";
import { listQueuedCompletions, syncQueuedCompletions, QueuedCompletion } from "@/lib/offline-queue";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function TechnicianPage() {
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  const [pmPlans, setPmPlans] = useState<PMPlan[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [queued, setQueued] = useState<QueuedCompletion[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function refreshQueue() {
    try {
      setQueued(await listQueuedCompletions());
    } catch {
      // IndexedDB unavailable — offline queue simply won't show; not fatal
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncQueuedCompletions((pmId, payload, file, checklistResponses) =>
        api.completePM(pmId, payload, file, checklistResponses)
      );
      await refreshQueue();
      if (result.synced || result.failed) {
        setSyncMessage(
          `Synced ${result.synced} completion${result.synced === 1 ? "" : "s"}` +
            (result.failed ? `, ${result.failed} still pending` : ".")
        );
      }
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    setIsOnline(navigator.onLine);
    refreshQueue().then(() => {
      if (navigator.onLine) runSync();
    });
    const goOnline = () => {
      setIsOnline(true);
      runSync();
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    const u = getUser();
    setUser(u);
    if (!u) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [pm, wo, m] = await Promise.all([
          api.myPm().catch(() => []),
          api.myWorkOrders().catch(() => []),
          api.machines().catch(() => []),
        ]);
        setPmPlans(pm);
        setWorkOrders(wo);
        setMachines(m);
      } catch (err: any) {
        setError(err.message || "Failed to load your work");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const machineById = new Map(machines.map((m) => [m.id, m]));
  const today = new Date().toISOString().slice(0, 10);

  const overduePm = pmPlans.filter((p) => p.status === "OVERDUE" || p.status === "MISSED");
  const dueTodayPm = pmPlans.filter((p) => p.planned_date === today && p.status !== "COMPLETED" && !overduePm.includes(p));
  const upcomingPm = pmPlans.filter(
    (p) => !overduePm.includes(p) && !dueTodayPm.includes(p) && p.status !== "COMPLETED"
  );
  const completedPm = pmPlans.filter((p) => p.status === "COMPLETED");

  const openWorkOrders = workOrders.filter((w) => w.status !== "CLOSED" && w.status !== "VERIFIED");

  if (!user && !loading) {
    return (
      <div className="p-6 max-w-sm mx-auto text-center space-y-3">
        <p className="text-sm text-muted">Log in to see your assigned work.</p>
        <Link href="/login" className="inline-block text-sm px-4 py-2 rounded-sm bg-ink text-white">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-5 pb-16">
      <div>
        <h1 className="text-lg font-semibold text-ink">{greeting()}{user ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <p className="text-sm text-muted">Today's work</p>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}
      {loading && <div className="text-sm text-muted">Loading…</div>}

      {!isOnline && (
        <div className="text-xs text-warn bg-amber-50 border border-amber-100 rounded-sm px-3 py-2">
          You're offline — showing your last synced task list. Completions you save now will sync automatically once you're back online.
        </div>
      )}

      {queued.length > 0 && (
        <div className="kpi-card !p-3 space-y-2 border-l-2 border-warn">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{queued.length} completion{queued.length === 1 ? "" : "s"} pending sync</div>
            <button
              onClick={runSync}
              disabled={syncing || !isOnline}
              className="text-xs text-accent hover:underline disabled:opacity-40 disabled:no-underline"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          </div>
          <ul className="text-xs text-muted space-y-0.5">
            {queued.map((q) => (
              <li key={q.localId} className={q.lastError ? "text-bad" : ""}>
                {q.machineLabel} — queued {new Date(q.queuedAt).toLocaleTimeString()}
                {q.lastError ? ` — ${q.lastError}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {syncMessage && <div className="text-xs text-good">{syncMessage}</div>}

      {!loading && (
        <>
          <SummaryRow overdue={overduePm.length} due={dueTodayPm.length + openWorkOrders.length} done={completedPm.length} />

          {openWorkOrders.length > 0 && (
            <Section title="Work Orders" tone="bad">
              {openWorkOrders.map((w) => (
                <WorkOrderCard key={w.id} wo={w} machine={machineById.get(w.machine_id)} />
              ))}
            </Section>
          )}

          {overduePm.length > 0 && (
            <Section title="Overdue PM" tone="bad">
              {overduePm.map((p) => (
                <PMCard key={p.id} plan={p} machine={machineById.get(p.machine_id)} />
              ))}
            </Section>
          )}

          {dueTodayPm.length > 0 && (
            <Section title="Due Today" tone="warn">
              {dueTodayPm.map((p) => (
                <PMCard key={p.id} plan={p} machine={machineById.get(p.machine_id)} />
              ))}
            </Section>
          )}

          {upcomingPm.length > 0 && (
            <Section title="Upcoming" tone="muted">
              {upcomingPm.slice(0, 10).map((p) => (
                <PMCard key={p.id} plan={p} machine={machineById.get(p.machine_id)} />
              ))}
            </Section>
          )}

          {completedPm.length > 0 && (
            <Section title="Completed recently" tone="good">
              {completedPm.slice(0, 5).map((p) => (
                <PMCard key={p.id} plan={p} machine={machineById.get(p.machine_id)} done />
              ))}
            </Section>
          )}

          {pmPlans.length === 0 && openWorkOrders.length === 0 && (
            <div className="kpi-card text-sm text-muted text-center py-8">
              Nothing assigned to you right now.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryRow({ overdue, due, done }: { overdue: number; due: number; done: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="kpi-card !p-3">
        <div className={`text-xl font-semibold ${overdue ? "text-bad" : "text-ink"}`}>{overdue}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted">Overdue</div>
      </div>
      <div className="kpi-card !p-3">
        <div className={`text-xl font-semibold ${due ? "text-warn" : "text-ink"}`}>{due}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted">Due Today</div>
      </div>
      <div className="kpi-card !p-3">
        <div className="text-xl font-semibold text-good">{done}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted">Completed</div>
      </div>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: "bad" | "warn" | "good" | "muted"; children: React.ReactNode }) {
  const dot = tone === "bad" ? "bg-bad" : tone === "warn" ? "bg-warn" : tone === "good" ? "bg-good" : "bg-muted";
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted uppercase tracking-wide">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function PMCard({ plan, machine, done }: { plan: PMPlan; machine?: Machine; done?: boolean }) {
  const body = (
    <div className="kpi-card !p-3 flex items-center justify-between">
      <div>
        <div className="text-sm font-medium">{machine ? machine.machine_number : plan.machine_id.slice(0, 8)}</div>
        <div className="text-xs text-muted">{machine?.machine_name}</div>
        <div className="text-xs text-muted mt-0.5">{plan.planned_date || plan.month}</div>
      </div>
      {!done && <span className="text-xs text-accent">Start →</span>}
      {done && <span className="text-xs text-good">✓ Done</span>}
    </div>
  );
  if (done) return body;
  return (
    <Link href={`/pm/${plan.id}/complete`} className="block active:opacity-70">
      {body}
    </Link>
  );
}

function WorkOrderCard({ wo, machine }: { wo: WorkOrder; machine?: Machine }) {
  return (
    <Link href={`/work-orders/${wo.id}`} className="block active:opacity-70">
      <div className="kpi-card !p-3 flex items-center justify-between border-l-2 border-bad">
        <div>
          <div className="text-sm font-medium">{wo.display_number} — {wo.title}</div>
          <div className="text-xs text-muted">{machine ? machine.machine_number : wo.machine_id.slice(0, 8)}</div>
          <div className="text-xs text-muted mt-0.5">{wo.status.replace(/_/g, " ")}{wo.due_date ? ` · due ${wo.due_date}` : ""}</div>
        </div>
        <span className="text-xs text-accent">Open →</span>
      </div>
    </Link>
  );
}
