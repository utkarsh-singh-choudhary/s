"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ChecklistItem } from "@/lib/api";
import { queueCompletion } from "@/lib/offline-queue";

type Loaded = {
  machineLabel: string;
  items: ChecklistItem[];
};

export default function CompletePMPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actualDate, setActualDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [downtime, setDowntime] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [checks, setChecks] = useState<Record<string, { checked: boolean; note: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const plan = await api.pm(id);
        const machine = await api.machine(plan.machine_id).catch(() => null);
        const checklist = await api
          .checklistForMachine(plan.machine_id)
          .catch(() => ({ template_id: null, items: [] as ChecklistItem[] }));
        setLoaded({
          machineLabel: machine ? `${machine.machine_number} — ${machine.machine_name}` : plan.machine_id,
          items: checklist.items,
        });
        const initialChecks: Record<string, { checked: boolean; note: string }> = {};
        checklist.items.forEach((item) => {
          initialChecks[item.id] = { checked: false, note: "" };
        });
        setChecks(initialChecks);
      } catch (err: any) {
        setLoadError(err.message || "Failed to load PM plan");
      }
    })();
  }, [id]);

  const requiredMissing = loaded ? loaded.items.filter((i) => i.required && !checks[i.id]?.checked) : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const checklistResponses = loaded?.items.map((item) => ({
      item_id: item.id,
      checked: checks[item.id]?.checked || false,
      note: checks[item.id]?.note || undefined,
    }));
    const payload = {
      actual_date: actualDate,
      remarks: remarks || undefined,
      delay_reason: delayReason || undefined,
      downtime_minutes: downtime ? Number(downtime) : undefined,
    };

    // Offline: don't even attempt the request — queue immediately so the
    // technician gets a clear "saved, will sync" result instead of watching
    // a request hang and time out.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      try {
        await queueCompletion({
          pmId: id,
          machineLabel: loaded?.machineLabel || id,
          payload,
          checklistResponses,
          file,
        });
        setQueuedOffline(true);
        setTimeout(() => router.push("/technician"), 1500);
      } catch (err: any) {
        setError("Couldn't save offline either — " + (err.message || "unknown error") + ". Try again once you have signal.");
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      await api.completePM(id, payload, file, checklistResponses);
      setDone(true);
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (err: any) {
      // Online per navigator, but the request itself failed — likely a flaky
      // connection rather than a real validation error. Queue it rather than
      // making the technician re-type everything.
      const looksLikeNetworkFailure = err instanceof TypeError || /fetch|network/i.test(err?.message || "");
      if (looksLikeNetworkFailure) {
        try {
          await queueCompletion({ pmId: id, machineLabel: loaded?.machineLabel || id, payload, checklistResponses, file });
          setQueuedOffline(true);
          setTimeout(() => router.push("/technician"), 1500);
          return;
        } catch {
          // fall through to showing the original error
        }
      }
      setError(err.message || "Failed to complete PM");
    } finally {
      setLoading(false);
    }
  }

  if (queuedOffline) {
    return (
      <div className="p-6">
        <div className="kpi-card text-sm space-y-1">
          <div className="text-warn font-medium">Saved offline</div>
          <p className="text-muted">No connection right now — this completion is queued and will sync automatically once you're back online. Redirecting…</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="p-6">
        <div className="kpi-card text-good text-sm">PM marked complete. Redirecting…</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Complete Preventive Maintenance</h1>
        <p className="text-sm text-muted">
          {loaded ? loaded.machineLabel : loadError ? <span className="text-bad">{loadError}</span> : "Loading…"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="kpi-card gap-4">
        {!isOnline && (
          <div className="text-xs text-warn bg-amber-50 border border-amber-100 rounded-sm px-3 py-2">
            You're offline. This will be saved on your device and synced automatically once you're back online.
          </div>
        )}
        {error && (
          <div className="text-xs text-bad bg-red-50 border border-red-100 rounded-sm px-3 py-2">{error}</div>
        )}

        {loaded && loaded.items.length > 0 && (
          <div className="flex flex-col gap-2 border border-border rounded-sm p-3">
            <div className="text-xs font-medium text-muted uppercase tracking-wide">Checklist</div>
            {loaded.items
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((item) => (
                <div key={item.id} className="flex flex-col gap-1 border-b border-border last:border-b-0 pb-2 last:pb-0">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={checks[item.id]?.checked || false}
                      onChange={(e) =>
                        setChecks((prev) => ({ ...prev, [item.id]: { ...prev[item.id], checked: e.target.checked } }))
                      }
                      className="mt-0.5"
                    />
                    <span>
                      {item.text}
                      {item.required && <span className="text-bad ml-1">*</span>}
                    </span>
                  </label>
                  <input
                    placeholder="Note (optional)"
                    value={checks[item.id]?.note || ""}
                    onChange={(e) =>
                      setChecks((prev) => ({ ...prev, [item.id]: { ...prev[item.id], note: e.target.value } }))
                    }
                    className="ml-6 border border-border rounded-sm px-2 py-1 text-xs"
                  />
                </div>
              ))}
            {requiredMissing.length > 0 && (
              <div className="text-xs text-warn">
                {requiredMissing.length} required item{requiredMissing.length === 1 ? "" : "s"} still unchecked.
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Actual completion date</label>
          <input
            type="date"
            required
            value={actualDate}
            onChange={(e) => setActualDate(e.target.value)}
            className="border border-border rounded-sm px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Remarks</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            className="border border-border rounded-sm px-3 py-2 text-sm"
            rows={3}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Delay reason (if late)</label>
          <input
            value={delayReason}
            onChange={(e) => setDelayReason(e.target.value)}
            className="border border-border rounded-sm px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Downtime (minutes)</label>
          <input
            type="number"
            min={0}
            value={downtime}
            onChange={(e) => setDowntime(e.target.value)}
            className="border border-border rounded-sm px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted">Proof of work (photo or PDF) — audits look for this</label>
          <input
            type="file"
            accept=".jpg,.jpeg,.png,.pdf,.heic,.webp"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={loading || requiredMissing.length > 0}
          className="bg-ink text-white text-sm rounded-sm py-2 hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Submitting…" : isOnline ? "Mark Complete" : "Save offline (will sync later)"}
        </button>
      </form>
    </div>
  );
}
