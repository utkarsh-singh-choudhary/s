import { getToken } from "./auth";

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
  checklist_template_id?: string | null;
};

export type PMPlan = {
  id: string;
  machine_id: string;
  planned_date?: string;
  planned_week?: string;
  month: string;
  financial_year: string;
  status: string;
  low_confidence_actual: boolean;
};

export type AppSettingRow = {
  key: string;
  value: any;
  default: any;
  description: string;
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

export type ChecklistItem = { id: string; sequence: number; text: string; required: boolean };
export type ChecklistTemplate = { id: string; name: string; description?: string; items: ChecklistItem[] };

export const WORK_ORDER_STATUSES = [
  "OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS", "WAITING_APPROVAL", "COMPLETED", "VERIFIED", "CLOSED",
] as const;
export const WORK_ORDER_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

export type WorkOrder = {
  id: string;
  number: number;
  display_number: string;
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
  updated_at: string;
};

export type SparePartTransaction = {
  id: string;
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

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store", headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function apiPut<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || `API error ${res.status}: ${path}`);
  }
  return res.json();
}

export const api = {
  machines: () => apiGet<Machine[]>("/api/machines"),
  machine: (id: string) => apiGet<Machine>(`/api/machines/${id}`),
  machineQrcodeUrl: (id: string) => `${API_URL}/api/machines/${id}/qrcode`,
  machineHealthScore: (id: string) => apiGet<HealthScore>(`/api/machines/${id}/health-score`),

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

  health: () => apiGet<Record<string, string>>("/health"),
  auditLogs: () => apiGet<any[]>("/api/audit-logs"),

  adminSettings: () => apiGet<AppSettingRow[]>("/api/admin/settings"),
  updateAdminSetting: (key: string, value: any) => apiPut<{ key: string; value: any }>(`/api/admin/settings/${key}`, { value }),

  employees: () => apiGet<Employee[]>("/api/employees"),

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
      headers: { ...authHeaders() },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || `Failed to report breakdown (${res.status})`);
    }
    return res.json();
  },
  resolveBreakdown: async (eventId: string, payload: { resumed_at: string; action_taken?: string; resulted_in_scrap_or_replace?: boolean }) => {
    const qs = new URLSearchParams({ resumed_at: payload.resumed_at });
    if (payload.action_taken) qs.set("action_taken", payload.action_taken);
    if (payload.resulted_in_scrap_or_replace != null) qs.set("resulted_in_scrap_or_replace", String(payload.resulted_in_scrap_or_replace));
    const res = await fetch(`${API_URL}/api/breakdowns/${eventId}/resolve?${qs.toString()}`, {
      method: "POST",
      headers: { ...authHeaders() },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || `Failed to resolve breakdown (${res.status})`);
    }
    return res.json();
  },

  checklists: () => apiGet<ChecklistTemplate[]>("/api/checklists"),
  checklistForMachine: (machineId: string) => apiGet<{ template_id: string | null; items: ChecklistItem[] }>(`/api/checklists/for-machine/${machineId}`),

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
  }) => apiPost<SparePart>("/api/spare-parts", payload),
  adjustStock: (id: string, payload: { change: number; reason?: string; work_order_id?: string }) =>
    apiPost<SparePart>(`/api/spare-parts/${id}/adjust`, payload),

  workOrderParts: (id: string) => apiGet<ConsumedPart[]>(`/api/work-orders/${id}/parts`),
  consumePart: (workOrderId: string, payload: { spare_part_id: string; quantity: number; reason?: string }) =>
    apiPost<WorkOrder>(`/api/work-orders/${workOrderId}/consume-part`, payload),

  async completePM(
    pmId: string,
    payload: { actual_date: string; remarks?: string; delay_reason?: string; downtime_minutes?: number },
    file?: File | null,
    checklistResponses?: { item_id: string; checked: boolean; note?: string }[]
  ) {
    const form = new FormData();
    form.set("actual_date", payload.actual_date);
    if (payload.remarks) form.set("remarks", payload.remarks);
    if (payload.delay_reason) form.set("delay_reason", payload.delay_reason);
    if (payload.downtime_minutes != null) form.set("downtime_minutes", String(payload.downtime_minutes));
    if (file) form.set("attachment", file);
    if (checklistResponses && checklistResponses.length > 0) {
      form.set("checklist_responses", JSON.stringify(checklistResponses));
    }

    const res = await fetch(`${API_URL}/api/pm/${pmId}/complete`, {
      method: "POST",
      headers: { ...authHeaders() },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.detail || `Failed to complete PM (${res.status})`);
    }
    return res.json();
  },
};
