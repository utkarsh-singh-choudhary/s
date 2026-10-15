"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, PMAttachmentInfo, PMDetails } from "@/lib/api";
import { getUser, ROLE_CAN } from "@/lib/auth";
import { StatusPill } from "@/components/StatusPill";
import { fmtDate } from "@/lib/format";

type Viewing = { name: string; type: string; url: string; id: string | null } | null;

function fmtSize(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function Thumb({ pmId, att, onOpen }: { pmId: string; att: PMAttachmentInfo; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const isImage = att.content_type.startsWith("image/") && att.content_type !== "image/heic";

  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    let cancelled = false;
    api.pmAttachmentBlob(pmId, att.id).then((b) => {
      if (cancelled) return;
      url = URL.createObjectURL(b);
      setSrc(url);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pmId, att.id, isImage]);

  return (
    <button type="button" onClick={onOpen} className="w-24 h-24 border border-border rounded-sm overflow-hidden bg-surface flex items-center justify-center text-xs text-muted hover:border-accent">
      {isImage && src ? (
        <img src={src} alt={att.filename} className="w-full h-full object-cover" />
      ) : att.content_type === "application/pdf" ? (
        <span className="font-semibold text-bad">PDF</span>
      ) : (
        <span>{isImage ? "…" : "File"}</span>
      )}
    </button>
  );
}

export default function PMDetailClient({ pmId }: { pmId: string }) {
  const [data, setData] = useState<PMDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Viewing>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      setData(await api.pmDetails(pmId));
      setError(null);
    } catch (e: any) {
      setError(e.message || "Could not load this PM");
    }
  }, [pmId]);

  useEffect(() => {
    setRole(getUser()?.role);
    load();
  }, [load]);

  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);

  async function open(name: string, type: string, id: string | null) {
    setMsg(null);
    try {
      const blob = id ? await api.pmAttachmentBlob(pmId, id) : await api.pmLegacyAttachmentBlob(pmId);
      setViewing({ name, type, id, url: URL.createObjectURL(new Blob([blob], { type })) });
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function download(v: NonNullable<Viewing>) {
    const a = document.createElement("a");
    a.href = v.url;
    a.download = v.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.uploadPmAttachments(pmId, files);
      await load();
      setMsg(`${files.length} file${files.length === 1 ? "" : "s"} added.`);
    } catch (err: any) {
      setMsg(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(att: PMAttachmentInfo) {
    if (!confirm(`Delete "${att.filename}"? This cannot be undone.`)) return;
    try {
      await api.deletePmAttachment(pmId, att.id);
      setViewing(null);
      await load();
    } catch (err: any) {
      setMsg(err.message);
    }
  }

  if (error) {
    return (
      <div className="p-6 space-y-2">
        <p className="text-sm text-bad">{error}</p>
        <Link href="/pm" className="text-sm text-accent hover:underline">← PM Plans</Link>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-muted">Loading…</div>;

  const { plan, actual } = data;
  const canUpload = ROLE_CAN.completePM(role as any);
  const canDelete = role === "ADMIN" || role === "MANAGER";
  const done = plan.status === "COMPLETED" || plan.status === "PENDING_SUPERVISOR_CONFIRMATION";
  const fileCount = data.attachments.length + (data.legacy_attachment ? 1 : 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <Link href={`/machines/${plan.machine_id}`} className="text-xs text-accent hover:underline">← {plan.machine_number || "Machine"}</Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="text-lg font-semibold text-ink">
            PM — {plan.machine_number} {plan.machine_name}
          </h1>
          <StatusPill status={plan.status} />
          {plan.critical && <span className="status-pill bg-red-50 text-bad">CRITICAL</span>}
        </div>
        <p className="text-sm text-muted">
          Planned {plan.planned_date ? fmtDate(plan.planned_date) : (plan.planned_week ? `week ${plan.planned_week}` : plan.month)} · {plan.financial_year}
          {plan.location ? ` · ${plan.location}` : ""}
        </p>
        {!done && (
          <Link href={`/pm/${plan.id}/complete`} className="inline-block mt-2 text-sm text-accent hover:underline">
            Complete this PM →
          </Link>
        )}
      </div>

      <div className="kpi-card space-y-2">
        <div className="font-medium text-sm">Completion record</div>
        {actual ? (
          <dl className="text-sm grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            <Row label="Done on" value={fmtDate(actual.actual_date)} />
            <Row label="Result" value={actual.completion_class ? `${actual.completion_class}${actual.delay_days ? ` (${actual.delay_days > 0 ? "+" : ""}${actual.delay_days} d)` : ""}` : null} />
            <Row label="Completed by" value={actual.completed_by_name || data.completed_by_technician_name} />
            <Row label="Confirmed by" value={data.confirmed_by_name} />
            <Row label="Downtime (min)" value={actual.downtime_minutes != null ? String(actual.downtime_minutes) : null} />
            <Row label="Delay reason" value={actual.delay_reason} />
            <div className="sm:col-span-2"><Row label="Remarks" value={actual.remarks} /></div>
          </dl>
        ) : (
          <p className="text-sm text-muted">Not completed yet.</p>
        )}
      </div>

      {data.checklist.length > 0 && (() => {
        const res = (c: PMDetails["checklist"][number]) => c.result || (c.checked ? "PASS" : "FAIL");
        const pass = data.checklist.filter((c) => res(c) === "PASS").length;
        const fail = data.checklist.filter((c) => res(c) === "FAIL").length;
        const na = data.checklist.filter((c) => res(c) === "NA").length;
        const ver = data.checklist.find((c) => c.template_version)?.template_version;
        return (
          <div className="kpi-card !p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border font-medium text-sm flex flex-wrap gap-x-3">
              <span>Checklist{ver ? ` (v${ver})` : ""}</span>
              <span className="text-good">{pass} pass</span>
              <span className={fail ? "text-bad" : "text-muted"}>{fail} fail</span>
              <span className="text-muted">{na} N/A</span>
            </div>
            <ul className="divide-y divide-border">
              {data.checklist.map((c) => {
                const r = res(c);
                return (
                  <li key={c.item_id} className="px-4 py-2 text-sm flex gap-3">
                    <span className={`w-10 shrink-0 text-xs font-medium ${r === "PASS" ? "text-good" : r === "FAIL" ? "text-bad" : "text-muted"}`}>
                      {r === "NA" ? "N/A" : r}
                    </span>
                    <div>
                      <div>
                        {c.text}
                        {c.required && <span className="text-bad ml-1">*</span>}
                        {c.critical && <span className="status-pill bg-red-50 text-bad ml-1">CRITICAL</span>}
                      </div>
                      {c.reading && (
                        <div className="text-xs">Reading: {c.reading}{c.reading_unit ? ` ${c.reading_unit}` : ""}</div>
                      )}
                      {c.note && <div className="text-xs text-muted">{c.note}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })()}

      <div className="kpi-card space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">Photos &amp; documents ({fileCount})</div>
          {canUpload && (
            <div>
              <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.heic,.webp" onChange={onUpload} className="hidden" id="pm-upload" />
              <label htmlFor="pm-upload" className={`text-sm text-accent hover:underline cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
                {busy ? "Uploading…" : "+ Add photo / PDF"}
              </label>
            </div>
          )}
        </div>
        {msg && <div className="text-xs text-muted">{msg}</div>}
        {fileCount === 0 ? (
          <p className="text-sm text-muted">No photos or PDFs were uploaded for this PM.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {data.attachments.map((a) => (
              <div key={a.id} className="w-24">
                <Thumb pmId={pmId} att={a} onOpen={() => open(a.filename, a.content_type, a.id)} />
                <div className="text-[11px] truncate mt-1" title={a.filename}>{a.filename}</div>
                <div className="text-[10px] text-muted">{fmtSize(a.size_bytes)}</div>
              </div>
            ))}
            {data.legacy_attachment && (
              <div className="w-24">
                <button type="button" onClick={() => open(data.legacy_attachment!.filename, data.legacy_attachment!.content_type, null)}
                  className="w-24 h-24 border border-border rounded-sm bg-surface text-xs text-muted hover:border-accent">
                  Earlier upload
                </button>
                <div className="text-[11px] truncate mt-1">{data.legacy_attachment.filename}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex flex-col p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-sm flex-1 flex flex-col overflow-hidden max-w-5xl w-full mx-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border text-sm gap-3">
              <span className="truncate">{viewing.name}</span>
              <div className="flex items-center gap-4 shrink-0">
                <button onClick={() => download(viewing)} className="text-accent hover:underline">Download</button>
                {canDelete && viewing.id && (
                  <button onClick={() => remove(data.attachments.find((a) => a.id === viewing.id)!)} className="text-bad hover:underline">Delete</button>
                )}
                <button onClick={() => setViewing(null)} className="text-muted hover:text-ink">Close ✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center">
              {viewing.type === "application/pdf" ? (
                <iframe src={viewing.url} title={viewing.name} className="w-full h-full min-h-[70vh]" />
              ) : viewing.type === "image/heic" ? (
                <p className="text-sm text-muted p-6">This browser can't preview HEIC photos. Use Download to open it.</p>
              ) : (
                <img src={viewing.url} alt={viewing.name} className="max-w-full max-h-full object-contain" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value || "—"}</dd>
    </div>
  );
}
