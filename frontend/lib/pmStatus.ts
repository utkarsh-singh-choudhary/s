// A PM plan whose planned date has passed and which isn't finished is
// overdue, even if the daily job hasn't flipped its stored status yet.
// Uses the plant's local date (IST) so server and browser agree.
const NOT_OVERDUE_STATUSES = new Set([
  "COMPLETED",
  "CANCELLED",
  "PENDING_SUPERVISOR_CONFIRMATION",
  "MISSED",
  "OVERDUE",
]);

export function plantToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function effectiveStatus(status: string, plannedDate?: string | null): string {
  if (plannedDate && !NOT_OVERDUE_STATUSES.has(status) && plannedDate < plantToday()) {
    return "OVERDUE";
  }
  return status;
}

export function daysOverdue(plannedDate?: string | null): number {
  if (!plannedDate) return 0;
  const a = new Date(plantToday() + "T00:00:00Z").getTime();
  const b = new Date(plannedDate + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((a - b) / 86400000));
}
