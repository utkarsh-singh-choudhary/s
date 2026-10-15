import { getToken, logout } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export type Machine = {
  id: string;
  machine_number: string;
  machine_name: string;
  manufacturer?: string;
  specification?: string;
  location?: string;
  remarks?: string;
  critical: boolean;
  active: boolean;
  machine_type?: string | null;
  checklist_template_id?: string | null;
};

export type MachineIn = {
  machine_number: string;
  machine_name: string;
  manufacturer?: string;
  specification?: string;
  location?: string;
  remarks?: string;
  critical?: boolean;
  machine_type?: string | null;
  checklist_template_id?: string | null;
};

export type MachineUpdate = Partial<MachineIn>;

export type PMPlan = {
  id: string;
  machine_id: string;
  planned_date?: string;
  planned_week?: string;
  month: string;
  financial_year: string;
  status: string;
  low_confidence_actual: boolean;
  assigned_to?: string | null;
};

export type PMAttachmentInfo = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name?: string | null;
  created_at?: string | null;
};

export type PMDetails = {
  plan: {
    id: string; machine_id: string; machine_number?: string | null; machine_name?: string | null;
    location?: string | null; critical: boolean; planned_date?: string | null; planned_week?: string | null;
    month: string; financial_year: string; status: string; assigned_to?: string | null; assigned_to_name?: string | null;
  };
  actual: {
    actual_date?: string | null; remarks?: string | null; delay_reason?: string | null;
    downtime_minutes?: number | null; delay_days?: number | null; completion_class?: string | null;
    completed_by_name?: string | null; recorded_at?: string | null;
  } | null;
  completed_by_technician_name?: string | null;
  confirmed_by_name?: string | null;
  confirmed_at?: string | null;
  checklist: {
    item_id: string; text: string; required: boolean; checked: boolean; note?: string | null;
    result?: "PASS" | "FAIL" | "NA"; reading?: string | null; reading_unit?: string | null;
    critical?: boolean; template_version?: number | null;
  }[];
  attachments: PMAttachmentInfo[];
  legacy_attachment: { filename: string; content_type: string } | null;
};

export type QrSheetRow = {
  machine_id: string; machine_number: string; machine_name: string; location?: string | null;
  deep_link: string; qr_data_uri: string;
};

export type BulkCompleteResult = {
  requested: number;
  completed: string[];
  pending_confirmation: string[];
  skipped: { id: string; machine_number?: string; reason: string }[];
};

export type BulkStatusResult = {
  requested: number;
  updated: string[];
  skipped: { id: string; reason: string }[];
};

export type AuditLogEntry = {
  id: string;
  actor_id?: string | null;
  actor_name?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  old_value?: any;
  new_value?: any;
  ip_address?: string | null;
  created_at: string;
};

export type AppSettingRow = {
  key: string;
  value: any;
  default: any;
  description: string;
};

export type ReminderReadiness = {
  notifications_enabled: boolean;
  email_provider: string;
  email_provider_configured: boolean;
  active_employees: number;
  employees_reachable_by_email: number;
  open_plan_machines: number;
  machines_without_recipient: number;
  machines_without_recipient_list: { machine_id: string; machine_number: string | null; machine_name: string | null }[];
  cc_emails: string[];
  last_reminder_run: { date: string; at: string; results: Record<string, number> } | null;
  external_trigger_enabled: boolean;
};

export type Employee = {
  id: string;
  employee_code?: string;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  designation?: string;
  role: string;
  active: boolean;
  notification_email_enabled: boolean;
  notification_whatsapp_enabled: boolean;
  hourly_rate?: number | null;
};

export type BreakdownEvent = {
  id: string;
  machine_id: string;
  breakdown_at: string;
  resumed_at?: string | null;
  cause?: string;
  action_taken?: string;
  resulted_in_scrap_or_replace: boolean;
  reported_by?: string;
  reported_by_name?: string;
  repaired_by?: string;
  repaired_by_name?: string;
  is_open: boolean;
};

export type ReliabilityRow = {
  machine_id: string;
  machine_number: string;
  machine_name: string;
  breakdown_count: number;
  open_breakdowns: number;
  mtbf_hours: number | null;
  mttr_hours: number | null;
  events: any[];
};

export type ChecklistItem = {
  id: string; sequence: number; text: string; required: boolean;
  requires_reading?: boolean; reading_unit?: string | null; critical?: boolean; evidence_on_fail?: boolean;
};
export type ChecklistTemplate = {
  id: string; name: string; description?: string; active: boolean; items: ChecklistItem[];
  task_type?: string; machine_type?: string | null; version?: number;
};
export type ChecklistItemIn = {
  text: string; required?: boolean; requires_reading?: boolean; reading_unit?: string | null;
  critical?: boolean; evidence_on_fail?: boolean;
};
export type ChecklistTemplateIn = { name: string; description?: string; task_type?: string; machine_type?: string | null; items: ChecklistItemIn[] };
export type ChecklistTemplateUpdate = { name?: string; description?: string; task_type?: string; machine_type?: string | null; items?: ChecklistItemIn[] };
export type ChecklistAnswer = { item_id: string; result: "PASS" | "FAIL" | "NA"; reading?: string; note?: string };

export const WORK_ORDER_STATUSES = [
  "OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS", "WAITING_APPROVAL", "COMPLETED", "VERIFIED", "CLOSED",
] as const;
export const WORK_ORDER_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const FAILURE_CATEGORIES = ["MECHANICAL", "ELECTRICAL", "HYDRAULIC", "PNEUMATIC", "SOFTWARE", "LUBRICATION", "OTHER"] as const;
export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export const IMPACTS = ["STOPPED", "REDUCED", "QUALITY", "NONE"] as const;
export const RESOLUTION_CODES = ["REPAIRED", "REPLACED_PART", "ADJUSTED", "CLEANED_LUBRICATED", "SOFTWARE_FIX", "TEMPORARY_FIX", "NO_FAULT_FOUND", "EXTERNAL_VENDOR", "OTHER"] as const;

export type WorkOrder = {
  id: string;
  number: number;
  display_number: string;
  source?: string | null;
  cancelled?: boolean;
  cancel_reason?: string | null;
  waiting_reason?: string | null;
  safety_risk?: string | null;
  permit_required?: boolean;
  loto_required?: boolean;
  safety_confirmed?: boolean;
  estimated_hours?: number | null;
  estimated_cost?: number | null;
  diagnosis?: string | null;
  repair_summary?: string | null;
  resolution_code?: string | null;
  failure_category?: string | null;
  supervisor_id?: string | null;
  supervisor_name?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  completed_by_name?: string | null;
  restored_at?: string | null;
  reopen_count?: number;
  machine_id: string;
  breakdown_event_id?: string | null;
  pm_plan_id?: string | null;
  title: string;
  description?: string | null;
  priority: (typeof WORK_ORDER_PRIORITIES)[number];
  status: (typeof WORK_ORDER_STATUSES)[number];
  reported_by?: string | null;
  reported_by_name?: string | null;
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  due_date?: string | null;
  root_cause?: string | null;
  five_whys?: { question: string; answer: string }[] | null;
  action_taken?: string | null;
  parts_used?: string | null;
  labor_hours?: number | null;
  downtime_minutes?: number | null;
  closed_at?: string | null;
  verified_by?: string | null;
  verified_by_name?: string | null;
  created_at: string;
  updated_at: string;
};

export type SparePart = {
  id: string;
  part_code: string;
  name: string;
  description?: string | null;
  unit: string;
  stock_on_hand: number;
  minimum_stock: number;
  reserved_stock: number;
  available_stock: number;
  low_stock: boolean;
  unit_cost?: number | null;
  storage_location?: string | null;
  preferred_vendor?: string | null;
  category?: string | null;
  compatible_machine_ids?: string[];
  lead_time_days?: number | null;
  out_of_stock?: boolean;
  updated_at: string;
};

export type SparePartTransaction = {
  id: string;
  txn_type?: string;
  unit_cost?: number | null;
  work_order_number?: string | null;
  change: number;
  reason?: string | null;
  work_order_id?: string | null;
  performed_by?: string | null;
  performed_by_name?: string | null;
  created_at: string;
};

export type HealthScoreFactor = { key: string; label: string; score: number | null; detail: string };
export type HealthScore = {
  machine_id: string;
  machine_number: string;
  machine_name: string;
  overall_score: number | null;
  band: "HEALTHY" | "WATCH" | "AT_RISK" | "CRITICAL" | "UNKNOWN";
  factors: HealthScoreFactor[];
};

export type ConsumedPart = {
  id: string;
  spare_part_id: string;
  part_code?: string | null;
  part_name?: string | null;
  quantity: number;
  reason?: string | null;
  created_at: string;
};

export type CostReport = {
  start_date: string;
  end_date: string;
  labor_hour_cost: number;
  downtime_minute_cost: number;
  preventive: { downtime_cost: number; total_cost: number; pm_count: number };
  corrective: { labor_cost: number; downtime_cost: number; parts_cost: number; total_cost: number; work_order_count: number };
  grand_total: number;
  by_machine: {
    machine_id: string;
    machine_number: string | null;
    machine_name: string | null;
    work_orders: number;
    labor_cost: number;
    downtime_cost: number;
    parts_cost: number;
    total_cost: number;
  }[];
};

export type MonthlyReport = {
  month: string;
  financial_year: string;
  total_planned: number;
  completed: number;
  pending: number;
  overdue: number;
  completion_rate: number;
  on_time_rate: number;
  late_rate: number;
  machine_rows: any[];
  location_rows: any[];
  employee_rows: any[];
  overdue_list: any[];
};

export type DataQualityReport = {
  financial_year: string;
  total_issues: number;
  machines_missing_responsible: any[];
  machines_with_plan_gaps: any[];
  machines_missing_location: any[];
  plans_needing_review: any[];
  potential_duplicate_machines: any[];
};

/** The API sometimes answers {message, blockers[]} instead of a plain string - turn either into readable text. */
export function errText(detail: any, fallback: string): string {
  const d = detail?.detail ?? detail;
  if (!d) return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) return d.map((x) => x?.msg || String(x)).join("; ") || fallback;
  if (typeof d === "object") {
    const parts = [d.message, ...(Array.isArray(d.blockers) ? d.blockers : [])].filter(Boolean);
    return parts.length ? parts.join(" • ") : fallback;
  }
  return fallback;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window === "undefined") {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const token = cookieStore.get("pm_token")?.value;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// An expired/invalid login in the browser: clear it and go to the sign-in page
// instead of showing a raw "API error 401".
function handleUnauthorized(res: Response) {
  if (res.status === 401 && typeof window !== "undefined") {
    logout();
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: { ...(await authHeaders()) } });
  handleUnauthorized(res);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}


// ------------------------------------------------------------------ lists & filters

export type DateRangeQuery = {
  date_preset?: string; date_from?: string; date_to?: string; date_basis?: string;
};
export type Paged<T, S = Record<string, number>> = {
  items: T[]; total: number; page: number; page_size: number; pages: number;
  range?: { from?: string | null; to?: string | null; basis?: string };
  summary: S;
};

export type BreakdownRow = {
  id: string; bd_number?: string | null; machine_id: string; machine_number?: string | null; machine_name?: string | null;
  location?: string | null; critical_machine: boolean;
  breakdown_at: string; reported_at?: string | null; resumed_at?: string | null; closed_at?: string | null;
  downtime_minutes?: number | null; cause?: string | null; action_taken?: string | null;
  failure_category?: string | null; failure_mode?: string | null; severity: string; production_impact?: string | null;
  temporary_action?: string | null; corrective_action?: string | null; root_cause?: string | null;
  root_cause_confirmed: boolean; rca_status: string; status: string;
  reported_by_name?: string | null; repaired_by_name?: string | null; verified_by_name?: string | null;
  is_open: boolean; is_closed: boolean; recurring?: boolean | null;
};
export type BreakdownSummary = { total: number; open: number; restored: number; closed: number; recurring: number; downtime_hours: number };

export type FiveWhy = { question: string; answer: string; evidence: string; confirmed: boolean };
export type CorrectiveAction = {
  id: string; kind: string; description: string; owner_id?: string | null; owner_name?: string | null;
  target_date?: string | null; status: string; completed_at?: string | null;
  effectiveness: string; effectiveness_note?: string | null; overdue?: boolean;
};
export type CostSummary = {
  currency: string; parts: number; labour: number; labour_hours: number; external_services: number; consumables: number;
  other: number; pending_approval: number; actual_total: number; estimated_total?: number | null;
  downtime_minutes?: number; downtime_cost?: number; downtime_open?: boolean; work_order_count?: number;
};
export type EvidenceInfo = {
  id: string; filename: string; content_type: string; size_bytes: number; label?: string | null;
  uploaded_by_name?: string | null; created_at?: string | null;
};
export type BreakdownDetail = BreakdownRow & {
  rca: {
    symptom?: string; observed_condition?: string; immediate_cause?: string; contributing_factors?: string[];
    five_whys?: FiveWhy[]; fishbone?: Record<string, string[]>; confirmed_at?: string;
  };
  rca_confirmed_by_name?: string | null; closed_by_name?: string | null;
  actions: CorrectiveAction[];
  work_orders: { id: string; display_number: string; title: string; status: string; priority?: string | null; assigned_to_name?: string | null; cancelled: boolean }[];
  costs: CostSummary;
  similar: { id: string; bd_number?: string | null; breakdown_at: string; machine_number?: string | null; same_machine: boolean; failure_category?: string | null; failure_mode?: string | null; root_cause?: string | null; status: string }[];
  allowed_next_statuses: string[];
  [k: string]: any;
};

export type WorkOrderRow = WorkOrder & {
  machine_number?: string | null; machine_name?: string | null; overdue?: boolean; status_value?: string; actual_cost?: number;
};
export type WorkOrderSummary = { total: number; open: number; overdue: number; completed: number; downtime_hours: number };
export type WorkOrderDetail = {
  work_order: WorkOrder;
  machine: { id: string; machine_number: string; machine_name: string; location?: string | null; critical: boolean; machine_type?: string | null } | null;
  breakdown: { id: string; bd_number?: string | null; severity: string; status: string } | null;
  parent_work_order_id?: string | null;
  child_work_orders: { id: string; display_number: string; title: string; status: string }[];
  logs: { id: string; event: string; from_status?: string | null; to_status?: string | null; reason?: string | null; note?: string | null; by_name?: string | null; at: string }[];
  labour: { id: string; technician_id: string; technician_name?: string | null; started_at?: string | null; ended_at?: string | null; hours: number; hourly_rate: number; cost: number; note?: string | null }[];
  cost_items: { id: string; category: string; description: string; amount: number; tax_amount: number; vendor?: string | null; invoice_ref?: string | null; recorded_by_name?: string | null; recorded_at?: string | null; approved: boolean; approved_by_name?: string | null; approved_at?: string | null }[];
  parts: { id: string; spare_part_id: string; part_code?: string | null; part_name?: string | null; kind: string; quantity: number; unit_cost?: number | null; cost: number; created_at: string; reason?: string | null }[];
  cost_summary: CostSummary;
  checklist: {
    template: { id: string; name: string; version: number; task_type: string } | null;
    items: (ChecklistItem & { result?: string | null; reading?: string | null; note?: string | null })[];
    blockers: string[]; critical_fails: string[];
  };
  evidence: EvidenceInfo[];
  allowed_next_statuses: string[];
  requires_verification: boolean;
  completion_blockers: string[];
  resolution_codes: string[];
};

export type PMRow = {
  id: string; machine_id: string; machine_number: string; machine_name: string; location?: string | null; critical: boolean;
  planned_date?: string | null; planned_week?: string | null; month: string; financial_year: string; status: string;
  effective_status: string; days_overdue: number; assigned_to?: string | null; assigned_to_name?: string | null;
  actual_date?: string | null; completed_by_name?: string | null; completion_class?: string | null;
  delay_days?: number | null; downtime_minutes?: number | null; file_count: number;
};
export type PMSummary = { total: number; completed: number; planned: number; overdue: number; missed: number; pending_confirmation: number };

export type Kpis = {
  currency: string;
  pm: { planned: number; completed: number; planned_and_completed: number; overdue: number; missed: number };
  breakdowns: { new: number; open: number; restored: number; recurring: number };
  spend: { total: number; parts: number; labour: number; external_and_other: number };
  downtime: { hours: number; breakdown_hours: number; pm_hours: number };
  definitions: Record<string, string>;
};

export type AnalyticsOverview = {
  summary: {
    period_from?: string | null; period_to?: string | null; breakdowns: number; repeat_failures: number; repeat_rate_pct: number | null;
    downtime_minutes: number; downtime_cost: number; mttr_hours: number | null; maintenance_cost: number;
    pm_due: number; pm_completed: number; pm_compliance_pct: number | null; pm_on_time_pct: number | null;
    currency: string; mtbf_min_failures: number;
  };
  machines: {
    machine_id: string; machine_number: string; machine_name: string; critical: boolean; machine_type?: string | null;
    breakdown_count: number; repeat_count: number; downtime_minutes: number; downtime_cost: number;
    mttr_hours: number | null; mtbf_hours: number | null; mtbf_status: string; maintenance_cost: number;
    cost_parts: number; cost_labour: number; cost_external: number;
    pm_due: number; pm_completed: number; pm_on_time: number; pm_compliance_pct: number | null;
  }[];
  trend: { month: string; breakdowns: number; downtime_minutes: number; cost: number; pm_due: number; pm_completed: number }[];
  failure_categories: { name: string; count: number }[];
  failure_modes: { name: string; count: number }[];
  overdue_critical: { pm_id: string; machine_id: string; machine_number: string; machine_name: string; planned_date: string; days_overdue: number }[];
  definitions: Record<string, string>;
};
export type AttentionItem = { kind: string; severity: "high" | "medium" | "low"; text: string; link?: string | null; count: number };
export type Workload = {
  from: string; to: string;
  people: { employee_id: string; name?: string; work_orders: number; in_progress: number; pm_plans: number; estimated_hours: number }[];
  conflicts: { type: string; person?: string | null; text: string }[];
};
export type StockAlerts = {
  low_stock: SparePart[];
  pm_at_risk: { part_id: string; part_code: string; part_name: string; stock_on_hand: number; minimum_stock: number; lead_time_days?: number | null; machine_id: string; machine_number?: string | null; planned_date: string; pm_plan_id: string }[];
  work_orders_waiting_for_parts: { id: string; display_number: string; title: string; machine_id: string }[];
};
export type PartUsage = { work_order_id: string; display_number: string; title: string; machine_number?: string | null; breakdown_id?: string | null; bd_number?: string | null; quantity: number; cost: number; last_movement: string };
export type AuditVerify = { total: number; intact: number; tampered: number; unsigned_legacy: number; mismatches: { id: string; action: string; entity_type?: string; entity_id?: string; created_at: string }[] };
export type DirectoryPerson = { id: string; name: string; role: string };

function qs(params: Record<string, any>): string {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, String(v));
  });
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function download(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { headers: { ...(await authHeaders()) } });
  handleUnauthorized(res);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(errText(detail, `Export failed (${res.status})`));
  }
  const cd = res.headers.get("content-disposition") || "";
  const name = /filename="?([^";]+)"?/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function apiPut<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  handleUnauthorized(res);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(errText(detail, `API error ${res.status}: ${path}`));
  }
  return res.json();
}

export type BulkImportKind = "spare-parts" | "employees";

export type BulkImportResult = {
  kind: string;
  totals: { rows: number; create: number; update: number; unchanged: number; error: number };
  rows: { row: number; key: string; name: string; action: "create" | "update" | "unchanged" | "error"; messages: string[] }[];
  truncated: boolean;
  applied?: { created: number; updated: number };
  generated_passwords?: { name: string; email: string; password: string }[];
};

async function apiUpload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { ...(await authHeaders()) }, body: form });
  handleUnauthorized(res);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(errText(detail, `API error ${res.status}: ${path}`));
  }
  return res.json();
}

async function downloadTemplate(kind: BulkImportKind): Promise<void> {
  const res = await fetch(`${API_URL}/api/bulk-import/${kind}/template`, { headers: { ...(await authHeaders()) } });
  handleUnauthorized(res);
  if (!res.ok) throw new Error(`Could not download the template (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kind}-import-template.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Authenticated file fetch -> Blob. <img src> / <a href> cannot send the
// Authorization header, so photos, PDFs and QR images are fetched this way.
async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, { headers: { ...(await authHeaders()) } });
  handleUnauthorized(res);
  if (!res.ok) throw new Error(`Could not load the file (${res.status})`);
  return res.blob();
}

async function uploadFiles<T>(path: string, files: File[]): Promise<T> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await fetch(`${API_URL}${path}`, { method: "POST", headers: { ...(await authHeaders()) }, body: form });
  handleUnauthorized(res);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(errText(detail, `Upload failed (${res.status})`));
  }
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { method: "DELETE", headers: { ...(await authHeaders()) } });
  handleUnauthorized(res);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(errText(detail, `API error ${res.status}: ${path}`));
  }
  return res.json();
}

async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
  handleUnauthorized(res);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(errText(detail, `API error ${res.status}: ${path}`));
  }
  return res.json();
}

export const api = {
  bulkImportTemplate: downloadTemplate,
  bulkImportPreview: (kind: BulkImportKind, file: File) =>
    apiUpload<BulkImportResult>(`/api/bulk-import/${kind}/preview`, file),
  bulkImportCommit: (kind: BulkImportKind, file: File) =>
    apiUpload<BulkImportResult>(`/api/bulk-import/${kind}/commit`, file),

  machines: (activeOnly: boolean = true) => apiGet<Machine[]>(`/api/machines?active_only=${activeOnly}`),
  machine: (id: string) => apiGet<Machine>(`/api/machines/${id}`),
  machineQrcodeBlob: (id: string) => {
    const base = typeof window !== "undefined" ? `?base=${encodeURIComponent(window.location.origin)}` : "";
    return fetchBlob(`/api/machines/${id}/qrcode${base}`);
  },
  machineQrSheet: () => apiGet<QrSheetRow[]>(`/api/machines/qrcodes/sheet?base=${encodeURIComponent(window.location.origin)}`),

  pmDetails: (id: string) => apiGet<PMDetails>(`/api/pm/${id}/details`),
  pmAttachmentBlob: (pmId: string, attId: string, download = false) =>
    fetchBlob(`/api/pm/${pmId}/attachments/${attId}/file${download ? "?download=true" : ""}`),
  pmLegacyAttachmentBlob: (pmId: string) => fetchBlob(`/api/pm/${pmId}/attachment`),
  uploadPmAttachments: (pmId: string, files: File[]) =>
    uploadFiles<{ success: boolean; added: number }>(`/api/pm/${pmId}/attachments`, files),
  deletePmAttachment: (pmId: string, attId: string) =>
    apiDelete<{ success: boolean }>(`/api/pm/${pmId}/attachments/${attId}`),
  machineHealthScore: (id: string) => apiGet<HealthScore>(`/api/machines/${id}/health-score`),
  createMachine: (payload: MachineIn) => apiPost<Machine>("/api/machines", payload),
  updateMachine: (id: string, payload: MachineUpdate) => apiPut<Machine>(`/api/machines/${id}`, payload),
  archiveMachine: (id: string) => apiPost<Machine>(`/api/machines/${id}/archive`, {}),
  restoreMachine: (id: string) => apiPost<Machine>(`/api/machines/${id}/restore`, {}),

  pmUpcoming: (days = 14) => apiGet<PMPlan[]>(`/api/pm/upcoming?days=${days}`),
  pmOverdue: () => apiGet<PMPlan[]>("/api/pm/overdue"),
  pmAll: () => apiGet<PMPlan[]>("/api/pm"),
  pmList: (params: { status?: string; machine_id?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set("status", params.status);
    if (params.machine_id) qs.set("machine_id", params.machine_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiGet<PMPlan[]>(`/api/pm${suffix}`);
  },
  pm: (id: string) => apiGet<PMPlan>(`/api/pm/${id}`),
  myPm: () => apiGet<PMPlan[]>("/api/pm/mine"),
  bulkCompletePM: (pmIds: string[], actualDate?: string) =>
    apiPost<BulkCompleteResult>("/api/pm/bulk-complete", { pm_ids: pmIds, actual_date: actualDate }),
  updatePM: (id: string, payload: Partial<{ planned_date: string | null; assigned_to: string | null }>) =>
    apiPut<PMPlan>(`/api/pm/${id}`, payload),

  health: () => apiGet<Record<string, string>>("/health"),
  auditLogs: (
    params: { limit?: number; entity_type?: string; action?: string; actor_id?: string; date_from?: string; date_to?: string } = {}
  ) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiGet<AuditLogEntry[]>(`/api/audit-logs${suffix}`);
  },
  auditEntityTypes: () => apiGet<string[]>("/api/audit-logs/entity-types"),

  adminSettings: () => apiGet<AppSettingRow[]>("/api/admin/settings"),
  updateAdminSetting: (key: string, value: any) => apiPut<{ key: string; value: any }>(`/api/admin/settings/${key}`, { value }),
  reminderReadiness: () => apiGet<ReminderReadiness>("/api/admin/settings/reminder-readiness"),
  runRemindersNow: () =>
    apiPost<{ success: boolean; results: Record<string, number> }>("/api/admin/settings/run-reminders-now", {}),
  sendTestEmail: (to: string) =>
    apiPost<{ success: boolean; provider?: string; error?: string | null }>("/api/admin/settings/test-email", { to }),

  employees: () => apiGet<Employee[]>("/api/employees"),
  createEmployee: (payload: {
    hourly_rate?: number;
    name: string;
    email: string;
    password: string;
    role: string;
    department?: string;
    designation?: string;
    phone?: string;
  }) => apiPost<{ id: string; name: string; email: string; role: string }>("/api/employees", payload),
  changePassword: (current_password: string, new_password: string) =>
    apiPost<{ success: boolean }>("/api/auth/change-password", { current_password, new_password }),
  resetEmployeePassword: (id: string, new_password: string) =>
    apiPost<{ success: boolean }>(`/api/employees/${id}/reset-password`, { new_password }),
  myProfile: () => apiGet<Employee>("/api/employees/me"),
  updateEmployee: (
    id: string,
    payload: Partial<
      Pick<
        Employee,
        "name" | "email" | "phone" | "department" | "designation" | "role" | "notification_email_enabled" | "notification_whatsapp_enabled" | "hourly_rate"
      >
    >
  ) => apiPut<Employee>(`/api/employees/${id}`, payload),
  bulkSetEmployeeStatus: (employeeIds: string[], active: boolean) =>
    apiPost<BulkStatusResult>("/api/employees/bulk-status", { employee_ids: employeeIds, active }),
  activateEmployee: (id: string) => apiPost<{ id: string; active: boolean }>(`/api/employees/${id}/activate`, {}),
  deactivateEmployee: (id: string) => apiPost<{ id: string; active: boolean }>(`/api/employees/${id}/deactivate`, {}),

  breakdowns: (params: { machine_id?: string; open_only?: boolean } = {}) => {
    const qs = new URLSearchParams();
    if (params.machine_id) qs.set("machine_id", params.machine_id);
    if (params.open_only) qs.set("open_only", "true");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiGet<BreakdownEvent[]>(`/api/breakdowns${suffix}`);
  },
  reliability: (machine_id?: string) =>
    apiGet<{ machines: ReliabilityRow[] }>(`/api/breakdowns/reliability${machine_id ? `?machine_id=${machine_id}` : ""}`),
  reportBreakdown: async (payload: { machine_id: string; breakdown_at: string; cause?: string }) => {
    const qs = new URLSearchParams({ machine_id: payload.machine_id, breakdown_at: payload.breakdown_at });
    if (payload.cause) qs.set("cause", payload.cause);
    const res = await fetch(`${API_URL}/api/breakdowns?${qs.toString()}`, {
      method: "POST",
      headers: { ...(await authHeaders()) },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(errText(detail, `Failed to report breakdown (${res.status})`));
    }
    return res.json();
  },
  resolveBreakdown: async (eventId: string, payload: { resumed_at: string; action_taken?: string; resulted_in_scrap_or_replace?: boolean }) => {
    const qs = new URLSearchParams({ resumed_at: payload.resumed_at });
    if (payload.action_taken) qs.set("action_taken", payload.action_taken);
    if (payload.resulted_in_scrap_or_replace != null) qs.set("resulted_in_scrap_or_replace", String(payload.resulted_in_scrap_or_replace));
    const res = await fetch(`${API_URL}/api/breakdowns/${eventId}/resolve?${qs.toString()}`, {
      method: "POST",
      headers: { ...(await authHeaders()) },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(errText(detail, `Failed to resolve breakdown (${res.status})`));
    }
    return res.json();
  },
  updateBreakdown: (
    eventId: string,
    payload: Partial<{ breakdown_at: string; resumed_at: string; cause: string; action_taken: string; resulted_in_scrap_or_replace: boolean }>
  ) => apiPut<BreakdownEvent>(`/api/breakdowns/${eventId}`, payload),


  // ---- breakdown lifecycle
  searchBreakdowns: (p: Record<string, any>) => apiGet<Paged<BreakdownRow, BreakdownSummary>>(`/api/breakdowns/search${qs(p)}`),
  exportBreakdowns: (p: Record<string, any>, format: "csv" | "xlsx") => download(`/api/breakdowns/export${qs({ ...p, format })}`, `breakdowns.${format}`),
  breakdownDetail: (id: string) => apiGet<BreakdownDetail>(`/api/breakdowns/${id}`),
  reportBreakdownFull: (payload: Record<string, any>) =>
    apiPost<{ id: string; bd_number: string; work_order_id?: string | null }>("/api/breakdowns/new", payload),
  breakdownStatus: (id: string, payload: { status: string; note?: string; resumed_at?: string; temporary_action?: string; corrective_action?: string }) =>
    apiPost<{ id: string; status: string }>(`/api/breakdowns/${id}/status`, payload),
  breakdownReopen: (id: string, reason: string) => apiPost<any>(`/api/breakdowns/${id}/reopen`, { reason }),
  saveRca: (id: string, payload: Record<string, any>) => apiPut<any>(`/api/breakdowns/${id}/rca`, payload),
  addAction: (id: string, payload: { kind: string; description: string; owner_id?: string; target_date?: string }) =>
    apiPost<CorrectiveAction>(`/api/breakdowns/${id}/actions`, payload),
  updateAction: (id: string, actionId: string, payload: Record<string, any>) =>
    apiPut<CorrectiveAction>(`/api/breakdowns/${id}/actions/${actionId}`, payload),
  deleteAction: (id: string, actionId: string) => apiDelete<{ success: boolean }>(`/api/breakdowns/${id}/actions/${actionId}`),
  raiseWorkOrderFromBreakdown: (id: string, payload: { title?: string; assigned_to?: string; priority?: string } = {}) =>
    apiPost<{ id: string; display_number: string; created: boolean }>(`/api/breakdowns/${id}/work-order`, payload),

  // ---- evidence (photos / PDFs on breakdowns and work orders)
  evidenceList: (type: "breakdown" | "work_order", id: string) => apiGet<EvidenceInfo[]>(`/api/evidence/${type}/${id}`),
  evidenceBlob: (type: "breakdown" | "work_order", id: string, fileId: string, download = false) =>
    fetchBlob(`/api/evidence/${type}/${id}/${fileId}/file${download ? "?download=true" : ""}`),
  evidenceUpload: (type: "breakdown" | "work_order", id: string, files: File[]) =>
    uploadFiles<{ success: boolean; added: number }>(`/api/evidence/${type}/${id}`, files),
  evidenceDelete: (type: "breakdown" | "work_order", id: string, fileId: string) =>
    apiDelete<{ success: boolean }>(`/api/evidence/${type}/${id}/${fileId}`),

  // ---- work order lifecycle
  searchWorkOrders: (p: Record<string, any>) => apiGet<Paged<WorkOrderRow, WorkOrderSummary>>(`/api/work-orders/search${qs(p)}`),
  exportWorkOrders: (p: Record<string, any>, format: "csv" | "xlsx") => download(`/api/work-orders/export${qs({ ...p, format })}`, `work_orders.${format}`),
  workOrderDetail: (id: string) => apiGet<WorkOrderDetail>(`/api/work-orders/${id}/detail`),
  createWorkOrderFull: (payload: Record<string, any>) => apiPost<WorkOrder>("/api/work-orders", payload),
  updateWorkOrderFields: (id: string, payload: Record<string, any>) => apiPut<WorkOrder>(`/api/work-orders/${id}`, payload),
  workOrderStatus: (id: string, payload: Record<string, any>) => apiPost<WorkOrder>(`/api/work-orders/${id}/status`, payload),
  workOrderLog: (id: string, payload: { event: string; reason?: string; note?: string; restored_at?: string; restore_machine?: boolean }) =>
    apiPost<WorkOrder>(`/api/work-orders/${id}/worklog`, payload),
  cancelWorkOrder: (id: string, reason: string) => apiPost<any>(`/api/work-orders/${id}/cancel`, { reason }),
  reopenWorkOrder: (id: string, reason: string) => apiPost<any>(`/api/work-orders/${id}/reopen`, { reason }),
  addLabour: (id: string, payload: { technician_id?: string; started_at?: string; ended_at?: string; hours?: number; note?: string }) =>
    apiPost<any>(`/api/work-orders/${id}/labour`, payload),
  deleteLabour: (id: string, labourId: string) => apiDelete<any>(`/api/work-orders/${id}/labour/${labourId}`),
  addCost: (id: string, payload: { category: string; description: string; amount: number; tax_amount?: number; vendor?: string; invoice_ref?: string }) =>
    apiPost<any>(`/api/work-orders/${id}/costs`, payload),
  approveCost: (id: string, costId: string) => apiPost<any>(`/api/work-orders/${id}/costs/${costId}/approve`, {}),
  deleteCost: (id: string, costId: string) => apiDelete<any>(`/api/work-orders/${id}/costs/${costId}`),
  consumePartRequest: (id: string, payload: { spare_part_id: string; quantity: number; reason?: string; request_id?: string }) =>
    apiPost<WorkOrder>(`/api/work-orders/${id}/consume-part`, payload),
  returnPart: (id: string, payload: { spare_part_id: string; quantity: number; reason?: string; request_id?: string }) =>
    apiPost<WorkOrder>(`/api/work-orders/${id}/return-part`, payload),
  saveWorkOrderChecklist: (id: string, answers: ChecklistAnswer[]) => apiPost<any>(`/api/work-orders/${id}/checklist`, { answers }),

  // ---- search / reports / analytics
  searchPM: (p: Record<string, any>) => apiGet<Paged<PMRow, PMSummary>>(`/api/activity/pm${qs(p)}`),
  exportPM: (p: Record<string, any>, format: "csv" | "xlsx") => download(`/api/activity/pm/export${qs({ ...p, format })}`, `pm_plans.${format}`),
  kpis: (p: Record<string, any>) => apiGet<Kpis>(`/api/activity/kpis${qs(p)}`),
  analytics: (p: Record<string, any>) => apiGet<AnalyticsOverview>(`/api/analytics/overview${qs(p)}`),
  attention: () => apiGet<{ items: AttentionItem[]; total: number }>("/api/analytics/attention"),
  workload: () => apiGet<Workload>("/api/analytics/workload"),
  directory: () => apiGet<DirectoryPerson[]>("/api/employees/directory"),
  verifyAudit: () => apiGet<AuditVerify>("/api/audit-logs/verify"),

  // ---- spare parts
  searchSpareParts: (p: Record<string, any>) => apiGet<SparePart[]>(`/api/spare-parts${qs(p)}`),
  sparePartCategories: () => apiGet<string[]>("/api/spare-parts/categories"),
  stockAlerts: () => apiGet<StockAlerts>("/api/spare-parts/alerts"),
  partUsage: (id: string) => apiGet<PartUsage[]>(`/api/spare-parts/${id}/usage`),
  adjustStockFull: (id: string, payload: { change: number; reason?: string; txn_type?: string; unit_cost?: number; request_id?: string }) =>
    apiPost<SparePart>(`/api/spare-parts/${id}/adjust`, payload),

  checklists: (includeInactive: boolean = false) =>
    apiGet<ChecklistTemplate[]>(`/api/checklists?include_inactive=${includeInactive}`),
  checklistTemplate: (id: string) => apiGet<ChecklistTemplate>(`/api/checklists/${id}`),
  checklistForMachine: (machineId: string, taskType = "PM") =>
    apiGet<{ template_id: string | null; name?: string; version?: number | null; task_type?: string; items: ChecklistItem[] }>(
      `/api/checklists/for-machine/${machineId}?task_type=${taskType}`),
  createChecklistTemplate: (payload: ChecklistTemplateIn) => apiPost<ChecklistTemplate>("/api/checklists", payload),
  updateChecklistTemplate: (id: string, payload: ChecklistTemplateUpdate) =>
    apiPut<ChecklistTemplate>(`/api/checklists/${id}`, payload),
  deactivateChecklistTemplate: (id: string) => apiPost<ChecklistTemplate>(`/api/checklists/${id}/deactivate`, {}),
  restoreChecklistTemplate: (id: string) => apiPost<ChecklistTemplate>(`/api/checklists/${id}/restore`, {}),
  assignChecklistTemplate: (templateId: string, machineId: string) =>
    apiPost<{ machine_id: string; checklist_template_id: string }>(`/api/checklists/${templateId}/assign/${machineId}`, {}),

  monthlyReport: (month: string, financial_year: string) =>
    apiGet<MonthlyReport>(`/api/reports/monthly?month=${encodeURIComponent(month)}&financial_year=${encodeURIComponent(financial_year)}`),
  dataQualityReport: (financial_year: string) =>
    apiGet<DataQualityReport>(`/api/reports/data-quality?financial_year=${encodeURIComponent(financial_year)}`),
  monthlyReportFileUrl: (month: string, financial_year: string, format: "pdf" | "xlsx") =>
    `${API_URL}/api/reports/monthly/generate?month=${encodeURIComponent(month)}&financial_year=${encodeURIComponent(financial_year)}&format=${format}`,
  costReport: (startDate?: string, endDate?: string) => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("start_date", startDate);
    if (endDate) qs.set("end_date", endDate);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiGet<CostReport>(`/api/reports/cost${suffix}`);
  },

  workOrders: (params: { machine_id?: string; status?: string; assigned_to?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.machine_id) qs.set("machine_id", params.machine_id);
    if (params.status) qs.set("status", params.status);
    if (params.assigned_to) qs.set("assigned_to", params.assigned_to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return apiGet<WorkOrder[]>(`/api/work-orders${suffix}`);
  },
  workOrder: (id: string) => apiGet<WorkOrder>(`/api/work-orders/${id}`),
  myWorkOrders: () => apiGet<WorkOrder[]>("/api/work-orders/mine"),
  createWorkOrder: (payload: {
    machine_id: string;
    title: string;
    description?: string;
    priority?: string;
    breakdown_event_id?: string;
    pm_plan_id?: string;
    assigned_to?: string;
    due_date?: string;
  }) => apiPost<WorkOrder>("/api/work-orders", payload),
  assignWorkOrder: (id: string, assigned_to: string) => apiPost<WorkOrder>(`/api/work-orders/${id}/assign`, { assigned_to }),
  updateWorkOrder: (
    id: string,
    payload: Partial<{ title: string; description: string; priority: string; due_date: string | null }>
  ) => apiPut<WorkOrder>(`/api/work-orders/${id}`, payload),
  updateWorkOrderStatus: (
    id: string,
    payload: {
      status: string;
      root_cause?: string;
      five_whys?: { question: string; answer: string }[];
      action_taken?: string;
      parts_used?: string;
      labor_hours?: number;
      downtime_minutes?: number;
    }
  ) => apiPost<WorkOrder>(`/api/work-orders/${id}/status`, payload),

  spareParts: (lowStockOnly = false) => apiGet<SparePart[]>(`/api/spare-parts${lowStockOnly ? "?low_stock_only=true" : ""}`),
  sparePart: (id: string) => apiGet<SparePart>(`/api/spare-parts/${id}`),
  sparePartTransactions: (id: string) => apiGet<SparePartTransaction[]>(`/api/spare-parts/${id}/transactions`),
  createSparePart: (payload: {
    part_code: string;
    name: string;
    description?: string;
    unit?: string;
    minimum_stock?: number;
    initial_stock?: number;
    unit_cost?: number;
    storage_location?: string;
    preferred_vendor?: string;
    category?: string;
    lead_time_days?: number;
    compatible_machine_ids?: string[];
  }) => apiPost<SparePart>("/api/spare-parts", payload),
  updateSparePart: (
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      unit: string;
      minimum_stock: number;
      unit_cost: number;
      storage_location: string;
      preferred_vendor: string;
      category: string;
      lead_time_days: number;
      compatible_machine_ids: string[];
    }>
  ) => apiPut<SparePart>(`/api/spare-parts/${id}`, payload),
  adjustStock: (id: string, payload: { change: number; reason?: string; work_order_id?: string }) =>
    apiPost<SparePart>(`/api/spare-parts/${id}/adjust`, payload),

  workOrderParts: (id: string) => apiGet<ConsumedPart[]>(`/api/work-orders/${id}/parts`),
  consumePart: (workOrderId: string, payload: { spare_part_id: string; quantity: number; reason?: string }) =>
    apiPost<WorkOrder>(`/api/work-orders/${workOrderId}/consume-part`, payload),

  async completePM(
    pmId: string,
    payload: { actual_date: string; remarks?: string; delay_reason?: string; downtime_minutes?: number },
    file?: File | File[] | null,
    checklistResponses?: ({ item_id: string; checked?: boolean; result?: string; reading?: string; note?: string })[]
  ) {
    const form = new FormData();
    form.set("actual_date", payload.actual_date);
    if (payload.remarks) form.set("remarks", payload.remarks);
    if (payload.delay_reason) form.set("delay_reason", payload.delay_reason);
    if (payload.downtime_minutes != null) form.set("downtime_minutes", String(payload.downtime_minutes));
    const files = Array.isArray(file) ? file : file ? [file] : [];
    files.forEach((f) => form.append("attachments", f));
    if (checklistResponses && checklistResponses.length > 0) {
      form.set("checklist_responses", JSON.stringify(checklistResponses));
    }

    const res = await fetch(`${API_URL}/api/pm/${pmId}/complete`, {
      method: "POST",
      headers: { ...(await authHeaders()) },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(errText(detail, `Failed to complete PM (${res.status})`));
    }
    return res.json();
  },
};
