"use client";

import { useEffect, useState } from "react";
import { api, AppSettingRow, ReminderReadiness } from "@/lib/api";

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<AppSettingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [testEmailTo, setTestEmailTo] = useState("");
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [readiness, setReadiness] = useState<ReminderReadiness | null>(null);
  const [ccDraft, setCcDraft] = useState("");
  const [ccSaving, setCcSaving] = useState(false);
  const [ccMsg, setCcMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [runningNow, setRunningNow] = useState(false);
  const [runMsg, setRunMsg] = useState<{ ok: boolean; message: string } | null>(null);

  function loadReadiness() {
    api
      .reminderReadiness()
      .then((r) => {
        setReadiness(r);
        setCcDraft(r.cc_emails.join(", "));
      })
      .catch(() => {});
  }

  useEffect(() => {
    loadReadiness();
  }, []);

  async function handleSaveCc() {
    setCcSaving(true);
    setCcMsg(null);
    try {
      const list = ccDraft.split(/[,;\s]+/).filter(Boolean);
      const updated = await api.updateAdminSetting("reminder_cc_emails", list);
      setCcMsg({ ok: true, message: `Saved ${(updated.value as string[]).length} address(es).` });
      loadReadiness();
      setSettings((prev) => prev.map((s) => (s.key === "reminder_cc_emails" ? { ...s, value: updated.value } : s)));
      setDrafts((prev) => ({ ...prev, reminder_cc_emails: JSON.stringify(updated.value, null, 2) }));
    } catch (e: any) {
      setCcMsg({ ok: false, message: e.message || "Failed to save" });
    } finally {
      setCcSaving(false);
    }
  }

  async function handleRunNow() {
    if (!confirm("Run the reminder job now? Reminders already sent today will not be sent again.")) return;
    setRunningNow(true);
    setRunMsg(null);
    try {
      const res = await api.runRemindersNow();
      const r = res.results || {};
      setRunMsg({
        ok: true,
        message: `Done. Upcoming: ${r.upcoming ?? 0}, due tomorrow: ${r.due_tomorrow ?? 0}, due today: ${r.due_today ?? 0}, overdue: ${r.overdue ?? 0}, escalated: ${r.escalated ?? 0}.`,
      });
    } catch (e: any) {
      setRunMsg({ ok: false, message: e.message || "Run failed" });
    } finally {
      setRunningNow(false);
    }
  }

  useEffect(() => {
    api
      .adminSettings()
      .then((rows) => {
        setSettings(rows);
        const d: Record<string, string> = {};
        rows.forEach((r) => (d[r.key] = JSON.stringify(r.value, null, 2)));
        setDrafts(d);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(key: string) {
    setSavingKey(key);
    setError(null);
    try {
      let parsed: any;
      try {
        parsed = JSON.parse(drafts[key]);
      } catch {
        const def = settings.find((x) => x.key === key)?.default;
        if (typeof def === "string" && (drafts[key] ?? "").trim() !== "") {
          parsed = drafts[key].trim(); // plain text is fine for text settings such as currency
        } else {
          throw new Error("Value must be valid JSON (e.g. 7, or [\"a\",\"b\"], or {...})");
        }
      }
      const updated = await api.updateAdminSetting(key, parsed);
      setSettings((prev) => prev.map((s) => (s.key === key ? { ...s, value: updated.value } : s)));
    } catch (e: any) {
      setError(e.message || "Failed to save");
    } finally {
      setSavingKey(null);
    }
  }

  async function handleSendTestEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!testEmailTo.trim()) return;
    setTestEmailSending(true);
    setTestEmailResult(null);
    try {
      const res = await api.sendTestEmail(testEmailTo.trim());
      setTestEmailResult(
        res.success
          ? { ok: true, message: `Test email sent via ${res.provider || "the active provider"}.` }
          : { ok: false, message: res.error || "Sending failed." }
      );
    } catch (err: any) {
      setTestEmailResult({ ok: false, message: err.message || "Sending failed." });
    } finally {
      setTestEmailSending(false);
    }
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Admin Settings</h1>
        <p className="text-sm text-muted">
          Reminder day-offsets, escalation thresholds, and the week→calendar-date convention.
          Changes take effect on the next scheduled job run — no deploy needed.
        </p>
      </div>

      {error && (
        <div className="text-xs text-bad bg-red-50 border border-red-100 rounded-sm px-3 py-2">{error}</div>
      )}

      <div className="kpi-card gap-2">
        <div className="font-medium text-sm text-ink">Automatic reminder emails</div>
        <div className="text-xs text-muted">
          Reminders go out every day at 8:00 AM to the people responsible for each machine, using the email on their
          employee record. Addresses below also get a copy of every reminder and escalation.
        </div>
        {readiness && (
          <ul className="text-xs space-y-1">
            <li className={readiness.notifications_enabled ? "text-good" : "text-bad"}>
              {readiness.notifications_enabled ? "Notifications are ON" : "Notifications are OFF (NOTIFICATIONS_ENABLED=false)"}
            </li>
            <li className={readiness.email_provider_configured ? "text-good" : "text-bad"}>
              Mail provider: {readiness.email_provider} —{" "}
              {readiness.email_provider_configured ? "configured" : "NOT configured (set the mail variables on the server)"}
            </li>
            <li className="text-muted">
              {readiness.employees_reachable_by_email} of {readiness.active_employees} active employees have an email with
              notifications enabled.
            </li>
            <li className="text-muted">
              Last automatic run:{" "}
              {readiness.last_reminder_run
                ? `${new Date(readiness.last_reminder_run.at).toLocaleString()} (for ${readiness.last_reminder_run.date})`
                : "none recorded yet"}
              {" · "}Daily external trigger: {readiness.external_trigger_enabled ? "enabled" : "not set up (see CRON_SECRET)"}
            </li>
            <li className={readiness.machines_without_recipient ? "text-bad" : "text-good"}>
              {readiness.machines_without_recipient} of {readiness.open_plan_machines} machines with open PM plans have nobody
              to notify
              {readiness.machines_without_recipient > 0 && (
                <>
                  :{" "}
                  {readiness.machines_without_recipient_list
                    .map((m) => m.machine_number || m.machine_name || m.machine_id)
                    .join(", ")}
                </>
              )}
            </li>
          </ul>
        )}
        <label className="text-xs text-muted mt-1">Extra addresses that get a copy (comma separated)</label>
        <textarea
          value={ccDraft}
          onChange={(e) => setCcDraft(e.target.value)}
          placeholder="plant.head@company.com, maintenance@company.com"
          rows={2}
          className="border border-border rounded-sm px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveCc}
            disabled={ccSaving}
            className="bg-ink text-white text-xs rounded-sm px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
          >
            {ccSaving ? "Saving…" : "Save addresses"}
          </button>
          <button
            onClick={handleRunNow}
            disabled={runningNow}
            className="border border-border text-ink text-xs rounded-sm px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50"
          >
            {runningNow ? "Running…" : "Send reminders now"}
          </button>
        </div>
        {ccMsg && <div className={`text-xs ${ccMsg.ok ? "text-good" : "text-bad"}`}>{ccMsg.message}</div>}
        {runMsg && <div className={`text-xs ${runMsg.ok ? "text-good" : "text-bad"}`}>{runMsg.message}</div>}
      </div>

      <form onSubmit={handleSendTestEmail} className="kpi-card gap-2">
        <div className="font-medium text-sm text-ink">Send test email</div>
        <div className="text-xs text-muted">
          Sends a test message through the active email provider so you can confirm reminders will actually be delivered.
        </div>
        <div className="flex items-center gap-2">
          <input
            type="email"
            required
            value={testEmailTo}
            onChange={(e) => setTestEmailTo(e.target.value)}
            placeholder="recipient@example.com"
            className="border border-border rounded-sm px-3 py-1.5 text-sm flex-1"
          />
          <button
            type="submit"
            disabled={testEmailSending}
            className="bg-ink text-white text-xs rounded-sm px-3 py-2 hover:opacity-90 disabled:opacity-50"
          >
            {testEmailSending ? "Sending…" : "Send test"}
          </button>
        </div>
        {testEmailResult && (
          <div className={`text-xs ${testEmailResult.ok ? "text-good" : "text-bad"}`}>{testEmailResult.message}</div>
        )}
      </form>

      {loading ? (
        <div className="text-sm text-muted">Loading…</div>
      ) : (
        <div className="space-y-4">
          {settings.map((s) => (
            <div key={s.key} className="kpi-card gap-2">
              <div className="flex items-baseline justify-between">
                <div className="font-mono text-sm font-medium text-ink">{s.key}</div>
                <div className="text-[11px] text-muted">default: {JSON.stringify(s.default)}</div>
              </div>
              <div className="text-xs text-muted">{s.description}</div>
              <textarea
                value={drafts[s.key] ?? ""}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [s.key]: e.target.value }))}
                className="border border-border rounded-sm px-3 py-2 text-sm font-mono"
                rows={s.key === "escalation_thresholds" ? 6 : 2}
              />
              <button
                onClick={() => handleSave(s.key)}
                disabled={savingKey === s.key}
                className="self-start bg-ink text-white text-xs rounded-sm px-3 py-1.5 hover:opacity-90 disabled:opacity-50"
              >
                {savingKey === s.key ? "Saving…" : "Save"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
