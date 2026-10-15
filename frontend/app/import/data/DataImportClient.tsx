"use client";

import { useState } from "react";
import Link from "next/link";
import { api, BulkImportKind, BulkImportResult } from "@/lib/api";
import { getUser } from "@/lib/auth";

const KINDS: { id: BulkImportKind; label: string; roles: string[]; blurb: string; backHref: string }[] = [
  {
    id: "spare-parts",
    label: "Spare parts",
    roles: ["ADMIN", "MANAGER", "SUPERVISOR"],
    blurb:
      "One part per row. Existing part codes are updated; Opening Stock applies to new parts only (stock of existing parts is never changed by an import).",
    backHref: "/spare-parts",
  },
  {
    id: "employees",
    label: "Employees",
    roles: ["ADMIN"],
    blurb:
      "One person per row. Existing emails are updated; passwords of existing people are never changed. New people without a password get a generated one, shown once after the import.",
    backHref: "/employees",
  },
];

const ACTION_STYLE: Record<string, string> = {
  create: "bg-green-50 text-good",
  update: "bg-blue-50 text-blue-700",
  unchanged: "bg-gray-100 text-muted",
  error: "bg-red-50 text-bad",
};

export default function DataImportClient({ initialKind }: { initialKind: BulkImportKind }) {
  const [kind, setKind] = useState<BulkImportKind>(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkImportResult | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "commit" | "template">(null);
  const [error, setError] = useState<string | null>(null);

  const me = getUser();
  const cfg = KINDS.find((k) => k.id === kind)!;
  const allowed = !!me && cfg.roles.includes(me.role);

  function reset(nextKind?: BulkImportKind) {
    if (nextKind) setKind(nextKind);
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  async function handleTemplate() {
    setBusy("template");
    setError(null);
    try {
      await api.bulkImportTemplate(kind);
    } catch (e: any) {
      setError(e.message || "Could not download the template");
    } finally {
      setBusy(null);
    }
  }

  async function handlePreview() {
    if (!file) return;
    setBusy("preview");
    setError(null);
    setPreview(null);
    setResult(null);
    try {
      setPreview(await api.bulkImportPreview(kind, file));
    } catch (e: any) {
      setError(e.message || "Could not read the file");
    } finally {
      setBusy(null);
    }
  }

  async function handleCommit() {
    if (!file) return;
    const t = preview?.totals;
    if (!confirm(`Import now? ${t?.create ?? 0} will be added and ${t?.update ?? 0} updated. Rows with errors are skipped.`)) return;
    setBusy("commit");
    setError(null);
    try {
      setResult(await api.bulkImportCommit(kind, file));
      setPreview(null);
    } catch (e: any) {
      setError(e.message || "Import failed");
    } finally {
      setBusy(null);
    }
  }

  function copyPasswords() {
    const lines = (result?.generated_passwords || []).map((g) => `${g.name}\t${g.email}\t${g.password}`);
    navigator.clipboard?.writeText(["Name\tEmail\tPassword", ...lines].join("\n"));
  }

  const validCount = (preview?.totals.create ?? 0) + (preview?.totals.update ?? 0);

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-lg font-semibold text-ink">Import from Excel</h1>
        <p className="text-sm text-muted">
          Add or update many records at once instead of typing them in. Looking for PM plans?{" "}
          <Link href="/import" className="text-accent hover:underline">Import PM Plan</Link>.
        </p>
      </div>

      <div className="flex gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => reset(k.id)}
            className={`text-sm px-3 py-1.5 rounded-sm border ${
              kind === k.id ? "bg-ink text-white border-ink" : "border-border hover:bg-surface"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {!allowed ? (
        <div className="text-sm text-bad">
          Your role cannot import {cfg.label.toLowerCase()}. Ask an {cfg.roles.includes("MANAGER") ? "admin, manager or supervisor" : "admin"}.
        </div>
      ) : (
        <>
          <div className="kpi-card gap-2">
            <div className="font-medium text-sm text-ink">1. Download the template</div>
            <div className="text-xs text-muted">{cfg.blurb}</div>
            <button
              onClick={handleTemplate}
              disabled={busy === "template"}
              className="self-start text-sm px-3 py-1.5 rounded-sm border border-border hover:bg-surface disabled:opacity-50"
            >
              {busy === "template" ? "Preparing…" : "Download Excel template"}
            </button>
          </div>

          <div className="kpi-card gap-2">
            <div className="font-medium text-sm text-ink">2. Choose your filled file and check it</div>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setPreview(null);
                setResult(null);
                setError(null);
              }}
              className="text-sm"
            />
            <button
              onClick={handlePreview}
              disabled={!file || busy !== null}
              className="self-start text-sm px-3 py-1.5 rounded-sm bg-ink text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "preview" ? "Checking…" : "Check file (nothing is saved yet)"}
            </button>
          </div>
        </>
      )}

      {error && <div className="bg-red-50 text-bad text-sm px-4 py-2 rounded-sm border border-red-200">{error}</div>}

      {preview && (
        <div className="kpi-card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border space-y-2">
            <div className="font-medium text-sm text-ink">3. Review</div>
            <div className="text-sm flex flex-wrap gap-x-5 gap-y-1">
              <span className="text-good">{preview.totals.create} to add</span>
              <span className="text-blue-700">{preview.totals.update} to update</span>
              <span className="text-muted">{preview.totals.unchanged} unchanged</span>
              <span className={preview.totals.error ? "text-bad font-medium" : "text-muted"}>
                {preview.totals.error} with errors (will be skipped)
              </span>
            </div>
            <button
              onClick={handleCommit}
              disabled={validCount === 0 || busy !== null}
              className="text-sm px-3 py-1.5 rounded-sm bg-accent text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "commit" ? "Importing…" : `Import ${validCount} row${validCount === 1 ? "" : "s"}`}
            </button>
            {preview.totals.error > 0 && (
              <div className="text-xs text-muted">Fix the errors in your file and check it again to include those rows.</div>
            )}
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>{kind === "spare-parts" ? "Part code" : "Email"}</th>
                  <th>Name</th>
                  <th>Result</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td className="font-mono text-xs">{r.key || "—"}</td>
                    <td>{r.name || "—"}</td>
                    <td>
                      <span className={`status-pill ${ACTION_STYLE[r.action]}`}>{r.action}</span>
                    </td>
                    <td className="text-xs">{r.messages.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.truncated && (
            <div className="px-4 py-2 text-xs text-muted border-t border-border">
              Showing the first {preview.rows.length} rows (errors first). All rows are included in the import.
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="kpi-card gap-3">
          <div className="font-medium text-sm text-good">
            Import complete: {result.applied?.created ?? 0} added, {result.applied?.updated ?? 0} updated
            {result.totals.error > 0 ? `, ${result.totals.error} skipped because of errors` : ""}.
          </div>
          {result.generated_passwords && result.generated_passwords.length > 0 && (
            <div className="space-y-2">
              <div className="text-sm text-ink">
                Generated passwords for new employees. They are shown only now — copy them and share each one securely.
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Password</th></tr>
                </thead>
                <tbody>
                  {result.generated_passwords.map((g) => (
                    <tr key={g.email}>
                      <td>{g.name}</td>
                      <td>{g.email}</td>
                      <td className="font-mono text-xs">{g.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={copyPasswords} className="text-sm px-3 py-1.5 rounded-sm border border-border hover:bg-surface">
                Copy all
              </button>
            </div>
          )}
          <div className="flex gap-3 text-sm">
            <Link href={cfg.backHref} className="text-accent hover:underline">View {cfg.label.toLowerCase()}</Link>
            <button onClick={() => reset()} className="text-accent hover:underline">Import another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
