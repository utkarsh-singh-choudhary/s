"use client";

export function Pagination({
  page, pages, total, pageSize, onPage, onPageSize,
}: {
  page: number; pages: number; total: number; pageSize: number;
  onPage: (p: number) => void; onPageSize?: (n: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm px-1">
      <div className="text-muted">
        {total === 0 ? "No records" : <>Showing <b className="text-ink">{from}–{to}</b> of <b className="text-ink">{total}</b></>}
      </div>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}
            className="border border-border rounded-sm px-1.5 py-1 text-xs" aria-label="Rows per page">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
        <button onClick={() => onPage(1)} disabled={page <= 1} className="px-2 py-1 border border-border rounded-sm disabled:opacity-40">«</button>
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="px-2 py-1 border border-border rounded-sm disabled:opacity-40">‹ Prev</button>
        <span className="text-muted">Page {page} of {pages}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} className="px-2 py-1 border border-border rounded-sm disabled:opacity-40">Next ›</button>
        <button onClick={() => onPage(pages)} disabled={page >= pages} className="px-2 py-1 border border-border rounded-sm disabled:opacity-40">»</button>
      </div>
    </div>
  );
}
