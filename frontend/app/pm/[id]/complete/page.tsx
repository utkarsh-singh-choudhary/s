"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, ChecklistItem } from "@/lib/api";
import { queueCompletion } from "@/lib/offline-queue";

type Loaded = {
  machineLabel: string;
  items: ChecklistItem[];
  templateName?: string;
  version?: number | null;
};

type Answer = { result: "" | "PASS" | "FAIL" | "NA"; reading: string; note: string };

export default function CompletePMPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actualDate, setActualDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState("");
  const [delayReason, setDelayReason] = useState("");
  const [downtime, setDowntime] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [checks, setChecks] = useState<Record<string, Answer>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [outcome, setOutcome] = useState<any>(null);
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
          templateName: (checklist as any).name,
          version: (checklist as any).version,
        });
        const initialChecks: Record<string, Answer> = {};
        checklist.items.forEach((item) => {
          initialChecks[item.id] = { result: "", reading: "", note: "" };
        });
        setChecks(initialChecks);
      } catch (err: any) {
        setLoadError(err.message || "Failed to load PM plan");
      }
    })();
  }, [id]);

  const requiredMissing = loaded
    ? loaded.items.filter((i) => {
        const a = checks[i.id];
        if (!a || !a.result) return i.required;
        if (a.result === "PASS" && i.requires_reading && !a.reading.trim()) return true;
        if (a.result === "FAIL" && !a.note.trim()) return true;
        return false;
      })
    : [];
  const failCount = loaded ? loaded.items.filter((i) => checks[i.id]?.result === "FAIL").length : 0;
  const criticalFail = loaded ? loaded.items.filter((i) => i.critical && checks[i.id]?.result === "FAIL") : [];
  const evidenceNeeded = loaded
    ? loaded.items.some((i) => i.evidence_on_fail && checks[i.id]?.result === "FAIL") && files.length === 0
    : false;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const checklistResponses = loaded?.items
      .filter((item) => checks[item.id]?.result)
      .map((item) => ({
        item_id: item.id,
        result: checks[item.id].result,
        reading: checks[item.id].reading.trim() || undefined,
        note: checks[item.id].note.trim() || undefined,
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
          file: files[0] || null,
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
      const res = await api.completePM(id, payload, files, checklistResponses);
      setOutcome(res);
      setDone(true);
      const hasCritical = Number(res?.critical_failures || 0) > 0;
      setTimeout(() => router.push(`/pm/${id}`), hasCritical ? 4500 : 1200);
    } catch (err: any) {
      // Online per navigator, but the request itself failed — likely a flaky
      // connection rather than a real validation error. Queue it rather than
      // making the technician re-type everything.
      const looksLikeNetworkFailure = err instanceof TypeError || /fetch|network/i.test(err?.message || "");
      if (looksLikeNetworkFailure) {
        try {
          await queueCompletion({ pmId: id, machineLabel: loaded?.machineLabel || id, payload, checklistResponses, file: files[0] || null });
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
        <div className="kpi-card text-sm space-y-2">
          <div className="text-good">PM marked complete. Opening its details…</div>
          {Number(outcome?.critical_failures || 0) > 0 && (
            <div className="text-warn bg-amber-50 border border-amber-100 rounded-sm px-3 py-2 text-xs">
              A critical check failed, so this PM is waiting for supervisor confirmation
              {outcome?.corrective_work_order_number ? ` and corrective work order ${outcome.corrective_work_order_number} was created.` : "."}
            </div>
          )}
        </div>
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
            <div className="text-xs font-medium text-muted uppercase tracking-wide">
              Checklist{loaded.templateName ? ` — ${loaded.templateName}` : ""}
              {loaded.version ? ` (v${loaded.version})` : ""}
            </div>
            {loaded.items
              .slice()
              .sort((a, b) => a.sequence - b.sequence)
              .map((item) => {
                const a = checks[item.id] || { result: "", reading: "", note: "" };
                const set = (p: Partial<Answer>) =>
                  setChecks((prev) => ({ ...prev, [item.id]: { ...prev[item.id], ...p } }));
                return (
                  <div key={item.id} className="flex flex-col gap-1.5 border-b border-border last:border-b-0 pb-2 last:pb-0">
                    <div className="text-sm">
                      {item.text}
                      {item.required && <span className="text-bad ml-1">*</span>}
                      {item.critical && <span className="status-pill bg-red-100 text-bad ml-1">CRITICAL</span>}
                    </div>
                    <div className="flex gap-1.5">
                      {(["PASS", "FAIL", "NA"] as const).map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => set({ result: a.result === r ? "" : r })}
                          className={`flex-1 text-xs rounded-sm border py-1.5 ${
                            a.result === r
                              ? r === "PASS"
                                ? "bg-good text-white border-good"
                                : r === "FAIL"
                                ? "bg-bad text-white border-bad"
                                : "bg-ink text-white border-ink"
                              : "border-border text-muted"
                          }`}
                        >
                          {r === "NA" ? "N/A" : r === "PASS" ? "Pass" : "Fail"}
                        </button>
                      ))}
                    </div>
                    {item.requires_reading && a.result !== "NA" && (
                      <div className="flex items-center gap-1.5">
                        <input
                          inputMode="decimal"
                          placeholder="Reading"
                          value={a.reading}
                          onChange={(e) => set({ reading: e.target.value })}
                          className="border border-border rounded-sm px-2 py-1 text-xs w-32"
                        />
                        {item.reading_unit && <span className="text-xs text-muted">{item.reading_unit}</span>}
                      </div>
                    )}
                    <input
                      placeholder={a.result === "FAIL" ? "What is wrong? (required)" : "Note (optional)"}
                      value={a.note}
                      onChange={(e) => set({ note: e.target.value })}
                      className={`border rounded-sm px-2 py-1 text-xs ${
                        a.result === "FAIL" && !a.note.trim() ? "border-bad" : "border-border"
                      }`}
                    />
                    {a.result === "FAIL" && item.evidence_on_fail && (
                      <span className="text-xs text-warn">Attach a photo of this problem below.</span>
                    )}
                  </div>
                );
              })}
            {requiredMissing.length > 0 && (
              <div className="text-xs text-warn">
                {requiredMissing.length} item{requiredMissing.length === 1 ? "" : "s"} still need an answer, reading or failure note.
              </div>
            )}
            {failCount > 0 && (
              <div className="text-xs text-bad">
                {failCount} check{failCount === 1 ? "" : "s"} failed.
                {criticalFail.length > 0 &&
                  " A critical item failed: the PM will go to a supervisor for confirmation and a corrective work order will be created."}
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
          <label className="text-xs text-muted">Proof of work (photos or PDFs, you can pick several) — audits look for this</label>
          <input
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.pdf,.heic,.webp"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="text-sm"
          />
          {files.length > 0 && <span className="text-xs text-muted">{files.length} file{files.length === 1 ? "" : "s"} selected</span>}
          {!isOnline && files.length > 1 && (
            <span className="text-xs text-warn">Offline: only the first file is saved on this device - add the rest from the PM details page after it syncs.</span>
          )}
        </div>

        <button
          type="submit"
          disabled={loading || requiredMissing.length > 0 || evidenceNeeded}
          className="bg-ink text-white text-sm rounded-sm py-2 hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Submitting…" : isOnline ? "Mark Complete" : "Save offline (will sync later)"}
        </button>
      </form>
    </div>
  );
}
