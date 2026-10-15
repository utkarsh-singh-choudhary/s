// Date and number formatting. Dates travel as ISO (YYYY-MM-DD) to and from the
// server and are SHOWN as dd-mm-yyyy.

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-14" or "2026-10-14T09:30:00" -> "14-10-2026" */
export function fmtDate(v?: string | null): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
}

/** "2026-10-14T09:30:00" -> "14-10-2026 09:30" */
export function fmtDateTime(v?: string | null): string {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : fmtDate(v);
}

/** Parse dd-mm-yyyy (also dd/mm/yyyy, dd.mm.yyyy) to ISO yyyy-mm-dd. Returns null if invalid. */
export function parseDisplayDate(text: string): string | null {
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/.exec(text);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Local "now" for <input type="datetime-local"> (yyyy-mm-ddThh:mm). */
export function nowLocalInput(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** datetime-local value -> what the API expects (adds seconds). */
export function localInputToApi(v: string): string {
  return v.length === 16 ? `${v}:00` : v;
}

/** API datetime -> value for <input type="datetime-local"> */
export function apiToLocalInput(v?: string | null): string {
  return v ? v.slice(0, 16) : "";
}

/** 135 -> "2 h 15 min" */
export function fmtMinutes(min?: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtHours(h?: number | null): string {
  return h == null ? "—" : `${Math.round(h * 100) / 100} h`;
}

export function fmtMoney(v?: number | null, currency = "INR"): string {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${currency} ${Math.round(v)}`;
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function label(v?: string | null): string {
  return v ? v.replace(/_/g, " ") : "—";
}
