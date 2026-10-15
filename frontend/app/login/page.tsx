"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(email, password);
      // Come back to where the person was headed (e.g. a scanned machine QR).
      // Only same-site relative paths are honoured.
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-sm font-semibold tracking-wide text-ink">PM AUTOMATION</div>
          <div className="text-[11px] text-muted">Preventive Maintenance System</div>
        </div>

        <form onSubmit={handleSubmit} className="kpi-card gap-4">
          <h1 className="text-base font-semibold text-ink">Sign in</h1>

          {error && (
            <div className="text-xs text-bad bg-red-50 border border-red-100 rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border border-border rounded-sm px-3 py-2 text-sm"
              placeholder="you@company.com"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border border-border rounded-sm px-3 py-2 text-sm"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="bg-ink text-white text-sm rounded-sm py-2 hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
