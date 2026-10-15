"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, QrSheetRow } from "@/lib/api";

export default function LabelsClient() {
  const [rows, setRows] = useState<QrSheetRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.machineQrSheet().then(setRows).catch((e) => setError(e.message || "Could not load QR codes"));
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <div>
          <Link href="/machines" className="text-xs text-accent hover:underline">← Machines</Link>
          <h1 className="text-lg font-semibold text-ink">QR labels</h1>
          <p className="text-sm text-muted">One label per active machine. Print, cut and stick on the machine.</p>
        </div>
        <button
          onClick={() => window.print()}
          disabled={!rows?.length}
          className="bg-ink text-white text-sm rounded-sm px-4 py-2 hover:opacity-90 disabled:opacity-50"
        >
          Print all
        </button>
      </div>

      {error && <div className="text-sm text-bad">{error}</div>}
      {!rows && !error && <div className="text-sm text-muted">Generating QR codes…</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 print:grid-cols-3">
        {rows?.map((r) => (
          <div key={r.machine_id} className="border border-border rounded-sm p-3 text-center break-inside-avoid">
            <img src={r.qr_data_uri} alt={`QR for ${r.machine_number}`} className="w-full max-w-[180px] mx-auto" />
            <div className="text-sm font-semibold mt-1">{r.machine_number}</div>
            <div className="text-xs">{r.machine_name}</div>
            {r.location && <div className="text-[11px] text-muted">{r.location}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
