"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, EvidenceInfo } from "@/lib/api";
import { fmtBytes, fmtDateTime } from "@/lib/format";

type Kind = "breakdown" | "work_order";
type Viewing = { name: string; type: string; url: string; id: string } | null;

function Thumb({ kind, entityId, file, onOpen }: { kind: Kind; entityId: string; file: EvidenceInfo; onOpen: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const isImage = file.content_type.startsWith("image/") && file.content_type !== "image/heic";
  useEffect(() => {
    if (!isImage) return;
    let url: string | null = null;
    let cancelled = false;
    api.evidenceBlob(kind, entityId, file.id).then((b) => {
      if (cancelled) return;
      url = URL.createObjectURL(b);
      setSrc(url);
    }).catch(() => {});
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [kind, entityId, file.id, isImage]);
  return (
    <button type="button" onClick={onOpen}
      className="w-24 h-24 border border-border rounded-sm overflow-hidden bg-surface flex items-center justify-center text-xs text-muted hover:border-accent">
      {isImage && src ? <img src={src} alt={file.filename} className="w-full h-full object-cover" />
        : file.content_type === "application/pdf" ? <span className="font-semibold text-bad">PDF</span>
        : <span>{isImage ? "…" : "File"}</span>}
    </button>
  );
}

/** Photos / PDFs attached to a breakdown or work order, with upload, preview, download and (managers) delete. */
export function EvidencePanel({
  kind, entityId, files, canUpload, canDelete, onChanged, title = "Photos & documents",
}: {
  kind: Kind; entityId: string; files: EvidenceInfo[]; canUpload: boolean; canDelete: boolean;
  onChanged: () => void | Promise<void>; title?: string;
}) {
  const [viewing, setViewing] = useState<Viewing>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (viewing) URL.revokeObjectURL(viewing.url); }, [viewing]);

  const open = useCallback(async (f: EvidenceInfo) => {
    setMsg(null);
    try {
      const blob = await api.evidenceBlob(kind, entityId, f.id);
      setViewing({ id: f.id, name: f.filename, type: f.content_type, url: URL.createObjectURL(new Blob([blob], { type: f.content_type })) });
    } catch (e: any) { setMsg(e.message); }
  }, [kind, entityId]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    if (!list.length) return;
    setBusy(true); setMsg(null);
    try {
      await api.evidenceUpload(kind, entityId, list);
      await onChanged();
      setMsg(`${list.length} file${list.length === 1 ? "" : "s"} added.`);
    } catch (err: any) { setMsg(err.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function remove(f: EvidenceInfo) {
    if (!confirm(`Delete "${f.filename}"? This cannot be undone.`)) return;
    try {
      await api.evidenceDelete(kind, entityId, f.id);
      setViewing(null);
      await onChanged();
    } catch (err: any) { setMsg(err.message); }
  }

  return (
    <div className="kpi-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm">{title} ({files.length})</div>
        {canUpload && (
          <div>
            <input ref={fileRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.heic,.webp" onChange={onUpload} className="hidden" id={`ev-${kind}-${entityId}`} />
            <label htmlFor={`ev-${kind}-${entityId}`} className={`text-sm text-accent hover:underline cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
              {busy ? "Uploading…" : "+ Add photo / PDF"}
            </label>
          </div>
        )}
      </div>
      {msg && <div className="text-xs text-muted">{msg}</div>}
      {files.length === 0 ? <p className="text-sm text-muted">Nothing uploaded yet.</p> : (
        <div className="flex flex-wrap gap-3">
          {files.map((f) => (
            <div key={f.id} className="w-24">
              <Thumb kind={kind} entityId={entityId} file={f} onOpen={() => open(f)} />
              <div className="text-[11px] truncate mt-1" title={f.filename}>{f.filename}</div>
              <div className="text-[10px] text-muted" title={f.created_at ? fmtDateTime(f.created_at) : ""}>{fmtBytes(f.size_bytes)}</div>
            </div>
          ))}
        </div>
      )}
      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex flex-col p-4" onClick={() => setViewing(null)}>
          <div className="bg-white rounded-sm flex-1 flex flex-col overflow-hidden max-w-5xl w-full mx-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border text-sm gap-3">
              <span className="truncate">{viewing.name}</span>
              <div className="flex items-center gap-4 shrink-0">
                <a href={viewing.url} download={viewing.name} className="text-accent hover:underline">Download</a>
                {canDelete && <button onClick={() => remove(files.find((x) => x.id === viewing.id)!)} className="text-bad hover:underline">Delete</button>}
                <button onClick={() => setViewing(null)} className="text-muted hover:text-ink">Close ✕</button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center">
              {viewing.type === "application/pdf" ? <iframe src={viewing.url} title={viewing.name} className="w-full h-full min-h-[70vh]" />
                : viewing.type === "image/heic" ? <p className="text-sm text-muted p-6">This browser can't preview HEIC photos. Use Download to open it.</p>
                : <img src={viewing.url} alt={viewing.name} className="max-w-full max-h-full object-contain" />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
