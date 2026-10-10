"use client";

import { useEffect, useState } from "react";
import { api, Employee } from "@/lib/api";

export default function ProfilePage() {
  const [profile, setProfile] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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
    </div>
  );
}
