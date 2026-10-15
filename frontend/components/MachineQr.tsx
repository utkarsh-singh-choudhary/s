"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function MachineQr({ machineId, label }: { machineId: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    api
      .machineQrcodeBlob(machineId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e) => !cancelled && setError(e.message || "Could not load the QR code"));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [machineId]);

  function printLabel() {
    if (!url) return;
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(
      `<html><head><title>${label}</title></head><body style="font-family:sans-serif;text-align:center;margin:24px">` +
        `<img src="${url}" style="width:300px;height:300px"/><div style="font-size:20px;font-weight:600;margin-top:8px"></div>` +
        `<script>window.onload=function(){window.print()}<\/script></body></html>`
    );
    const div = w.document.querySelector("div");
    if (div) div.textContent = label;
    w.document.close();
  }

  return (
    <div className="space-y-2">
      {url ? (
        <img src={url} alt="Machine QR code" className="w-28 h-28 border border-border rounded-sm" />
      ) : (
        <div className="w-28 h-28 border border-border rounded-sm flex items-center justify-center text-xs text-muted text-center px-1">
          {error ? "QR failed to load" : "Loading…"}
        </div>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex gap-3 text-xs">
        <a
          href={url || undefined}
          download={`${label.replace(/[^\w-]+/g, "_")}-qr.png`}
          className={`text-accent hover:underline ${url ? "" : "pointer-events-none opacity-50"}`}
        >
          Download PNG
        </a>
        <button type="button" onClick={printLabel} disabled={!url} className="text-accent hover:underline disabled:opacity-50">
          Print label
        </button>
      </div>
      <p className="text-xs text-muted">Scan on the shop floor to open this machine.</p>
    </div>
  );
}
