const TONES: Record<string, string> = {
  // severity / priority
  LOW: "bg-gray-100 text-muted", MEDIUM: "bg-blue-50 text-blue-700", HIGH: "bg-amber-50 text-amber-800", CRITICAL: "bg-red-50 text-bad",
  // breakdown lifecycle
  REPORTED: "bg-red-50 text-bad", UNDER_DIAGNOSIS: "bg-amber-50 text-amber-800", REPAIR_IN_PROGRESS: "bg-amber-50 text-amber-800",
  AWAITING_VERIFICATION: "bg-blue-50 text-blue-700", RESTORED: "bg-green-50 text-good", CLOSED: "bg-gray-100 text-muted",
  // RCA
  NOT_STARTED: "bg-gray-100 text-muted", IN_PROGRESS: "bg-amber-50 text-amber-800", UNVERIFIED: "bg-amber-50 text-amber-800", CONFIRMED: "bg-green-50 text-good",
  // work orders
  OPEN: "bg-blue-50 text-blue-700", ASSIGNED: "bg-blue-50 text-blue-700", WAITING_PARTS: "bg-amber-50 text-amber-800",
  WAITING_APPROVAL: "bg-amber-50 text-amber-800", COMPLETED: "bg-green-50 text-good", VERIFIED: "bg-green-50 text-good",
  // actions, results
  DONE: "bg-green-50 text-good", PASS: "bg-green-50 text-good", FAIL: "bg-red-50 text-bad", NA: "bg-gray-100 text-muted",
  EFFECTIVE: "bg-green-50 text-good", NOT_EFFECTIVE: "bg-red-50 text-bad", PENDING: "bg-gray-100 text-muted",
  PLANNED: "bg-blue-50 text-blue-700", OVERDUE: "bg-red-50 text-bad", MISSED: "bg-red-50 text-bad", CANCELLED: "bg-gray-100 text-muted",
  PENDING_SUPERVISOR_CONFIRMATION: "bg-blue-50 text-blue-700",
};

export function Pill({ value, text, tone }: { value?: string | null; text?: string; tone?: string }) {
  if (!value && !text) return <span className="text-muted">—</span>;
  return (
    <span className={`status-pill ${tone || TONES[value || ""] || "bg-gray-100 text-muted"}`}>
      {(text ?? value ?? "").replace(/_/g, " ")}
    </span>
  );
}
