"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Machine, PMPlan } from "@/lib/api";
import { StatusPill } from "@/components/StatusPill";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CalendarClient({ plans, machines }: { plans: PMPlan[]; machines: Machine[] }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);

  const byDate = useMemo(() => {
    const map = new Map<string, PMPlan[]>();
    for (const p of plans) {
      if (!p.planned_date) continue;
      const list = map.get(p.planned_date) || [];
      list.push(p);
      map.set(p.planned_date, list);
    }
    return map;
  }, [plans]);

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first offset
  const startOffset = (firstOfMonth.getDay() + 6) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function isoDate(day: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function goPrev() {
    setSelectedDate(null);
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goNext() {
    setSelectedDate(null);
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  const selectedPlans = selectedDate ? byDate.get(selectedDate) || [] : [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-ink">PM Calendar</h1>
          <p className="text-sm text-muted">Workload by day — click a day to see its PM jobs.</p>
        </div>
        <Link href="/pm" className="text-sm text-accent hover:underline">List view →</Link>
      </div>

      <div className="kpi-card !p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <button onClick={goPrev} className="text-sm px-2 py-1 rounded-sm hover:bg-surface">←</button>
          <div className="font-medium text-sm">{MONTH_NAMES[month]} {year}</div>
          <button onClick={goNext} className="text-sm px-2 py-1 rounded-sm hover:bg-surface">→</button>
        </div>

        <div className="grid grid-cols-7 text-xs text-muted border-b border-border">
          {WEEKDAYS.map((w) => (
            <div key={w} className="px-2 py-1.5 text-center">{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            if (day === null) return <div key={idx} className="border-b border-r border-border min-h-[84px] bg-surface/40" />;
            const dateStr = isoDate(day);
            const dayPlans = byDate.get(dateStr) || [];
            const completed = dayPlans.filter((p) => p.status === "COMPLETED").length;
            const overdue = dayPlans.filter((p) => p.status === "OVERDUE" || p.status === "MISSED").length;
            const pending = dayPlans.length - completed - overdue;
            const isSelected = selectedDate === dateStr;
            const isToday = dateStr === today.toISOString().slice(0, 10);

            return (
              <button
                key={idx}
                onClick={() => setSelectedDate(dayPlans.length ? dateStr : null)}
                className={`text-left border-b border-r border-border min-h-[84px] p-1.5 flex flex-col gap-1 ${
                  isSelected ? "bg-blue-50" : "hover:bg-surface"
                }`}
              >
                <div className={`text-xs ${isToday ? "font-semibold text-accent" : "text-muted"}`}>{day}</div>
                {dayPlans.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {completed > 0 && <Badge tone="good" count={completed} />}
                    {pending > 0 && <Badge tone="warn" count={pending} />}
                    {overdue > 0 && <Badge tone="bad" count={overdue} />}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="kpi-card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-medium text-sm">
            {selectedDate} — {selectedPlans.length} PM job{selectedPlans.length === 1 ? "" : "s"}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Machine</th>
                <th>Month</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {selectedPlans.map((p) => {
                const machine = machineById.get(p.machine_id);
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/machines/${p.machine_id}`} className="text-accent hover:underline">
                        {machine ? `${machine.machine_number} — ${machine.machine_name}` : p.machine_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td>{p.month}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td>
                      {p.status !== "COMPLETED" && p.status !== "CANCELLED" && (
                        <Link href={`/pm/${p.id}/complete`} className="text-xs text-accent hover:underline">
                          Complete
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Badge({ tone, count }: { tone: "good" | "warn" | "bad"; count: number }) {
  const cls = tone === "good" ? "bg-green-50 text-good" : tone === "warn" ? "bg-amber-50 text-warn" : "bg-red-50 text-bad";
  return <span className={`text-[10px] leading-none px-1 py-0.5 rounded-sm ${cls}`}>{count}</span>;
}
