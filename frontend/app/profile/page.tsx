"use client";

import { useEffect, useState } from "react";
import { api, Employee } from "@/lib/api";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleChangePassword(ev: React.FormEvent) {
    ev.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 8) {
      setPwMsg({ ok: false, message: "New password must be at least 8 characters." });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ ok: false, message: "New password and confirmation do not match." });
      return;
    }
    setPwBusy(true);
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", confirm: "" });
      setPwMsg({ ok: true, message: "Password changed. Use the new password next time you sign in." });
    } catch (err: any) {
      setPwMsg({ ok: false, message: err.message || "Could not change password" });
    } finally {
      setPwBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setProfile(await api.myProfile());
      } catch (err: any) {
        setError(err.message || "Failed to load your profile");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function toggle(field: "notification_email_enabled" | "notification_whatsapp_enabled") {
    if (!profile) return;
    const next = !profile[field];
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await api.updateEmployee(profile.id, { [field]: next });
      setProfile(updated);
      setSaved(true);
    } catch (err: any) {
      setError(err.message || "Failed to update notification settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted">Loading…</div>;
  }

  if (error && !profile) {
    return <div className="p-6 text-sm text-bad">{error}</div>;
  }

  if (!profile) return null;

  return (
    <div className="p-6 space-y-6 max-w-lg">
      <div>
        <h1 className="text-lg font-semibold text-ink">My Profile</h1>
        <p className="text-sm text-muted">Your account details and notification preferences.</p>
      </div>

      <div className="kpi-card space-y-2">
        <div className="font-medium text-sm">Account</div>
        <div className="text-sm space-y-1">
          <div><span className="text-muted">Name:</span> {profile.name}</div>
          <div><span className="text-muted">Email:</span> {profile.email || "—"}</div>
          <div><span className="text-muted">Phone:</span> {profile.phone || "—"}</div>
          <div><span className="text-muted">Role:</span> {profile.role}</div>
          {profile.department && <div><span className="text-muted">Department:</span> {profile.department}</div>}
          {profile.designation && <div><span className="text-muted">Designation:</span> {profile.designation}</div>}
        </div>
      </div>

      <div className="kpi-card space-y-3">
        <div className="font-medium text-sm">Notification Preferences</div>
        {error && <div className="text-sm text-bad">{error}</div>}
        <label className="flex items-center justify-between text-sm">
          <span>Email notifications (PM reminders, overdue alerts)</span>
          <input type="checkbox" checked={profile.notification_email_enabled} disabled={saving} onChange={() => toggle("notification_email_enabled")} />
        </label>
        <label className="flex items-center justify-between text-sm">
          <span>WhatsApp notifications</span>
          <input type="checkbox" checked={profile.notification_whatsapp_enabled} disabled={saving} onChange={() => toggle("notification_whatsapp_enabled")} />
        </label>
        {saved && !saving && <div className="text-xs text-good">Saved.</div>}
      </div>

      <form onSubmit={handleChangePassword} className="kpi-card space-y-2">
        <div className="font-medium text-sm">Change Password</div>
        <input type="password" required autoComplete="current-password" placeholder="Current password"
          value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })}
          className="border border-border rounded-sm px-3 py-1.5 text-sm w-full" />
        <input type="password" required autoComplete="new-password" minLength={8} placeholder="New password (min 8 characters)"
          value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })}
          className="border border-border rounded-sm px-3 py-1.5 text-sm w-full" />
        <input type="password" required autoComplete="new-password" placeholder="Confirm new password"
          value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
          className="border border-border rounded-sm px-3 py-1.5 text-sm w-full" />
        <button type="submit" disabled={pwBusy}
          className="bg-ink text-white text-xs rounded-sm px-3 py-2 hover:opacity-90 disabled:opacity-50">
          {pwBusy ? "Changing…" : "Change password"}
        </button>
        {pwMsg && <div className={`text-xs ${pwMsg.ok ? "text-good" : "text-bad"}`}>{pwMsg.message}</div>}
      </form>
    </div>
  );
}
