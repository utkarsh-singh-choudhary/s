import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function ChecklistsPage() {
  const templates = await safe(() => api.checklists(), []);

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Checklist Templates</h1>
        <p className="text-sm text-muted">
          {templates.length} template{templates.length === 1 ? "" : "s"}. Assign a template to a machine to require
          sub-step checks when its PM is completed.
        </p>
      </div>

      {templates.length === 0 ? (
        <div className="kpi-card text-sm text-muted">
          No checklist templates yet. Create one via the API (<code>POST /api/checklists</code>) to require
          structured sub-step checks on PM completion.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="kpi-card space-y-2">
              <div>
                <div className="font-medium text-sm">{t.name}</div>
                {t.description && <div className="text-xs text-muted">{t.description}</div>}
              </div>
              <ol className="text-sm space-y-1 list-decimal list-inside">
                {t.items
                  .slice()
                  .sort((a, b) => a.sequence - b.sequence)
                  .map((item) => (
                    <li key={item.id}>
                      {item.text}
                      {item.required && <span className="text-bad ml-1">*</span>}
                    </li>
                  ))}
              </ol>
              {t.items.length === 0 && <p className="text-xs text-muted">No items yet.</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
