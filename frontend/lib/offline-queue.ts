"use client";

// Offline queue for PM completions. Scope is deliberately narrow — this
// queues the one write action a technician is likely to make while actually
// standing at a machine with no signal (marking a PM done). Everything else
// (work order updates, spare-part consumption, admin actions) still requires
// connectivity, since those are desk/office actions, not shop-floor ones.
//
// Design: store the completion payload as plain data + the attachment as a
// File/Blob directly in IndexedDB (structured clone supports this natively
// in every modern browser — no base64 encoding needed). Nothing is retried
// automatically in the background; the technician sees a "N pending sync"
// count and syncing happens explicitly (on regaining connectivity, or via a
// manual "Sync now" tap), so failures are visible instead of silently lost.

const DB_NAME = "pm-offline-queue";
const DB_VERSION = 1;
const STORE = "pending-completions";

export type QueuedCompletion = {
  localId: string;
  pmId: string;
  machineLabel: string;
  payload: {
    actual_date: string;
    remarks?: string;
    delay_reason?: string;
    downtime_minutes?: number;
  };
  checklistResponses?: { item_id: string; checked: boolean; note?: string }[];
  file: File | null;
  queuedAt: string;
  lastError?: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueCompletion(entry: Omit<QueuedCompletion, "localId" | "queuedAt">): Promise<void> {
  const db = await openDb();
  const full: QueuedCompletion = {
    ...entry,
    localId: `${entry.pmId}-${Date.now()}`,
    queuedAt: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(full);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedCompletions(): Promise<QueuedCompletion[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedCompletion[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeQueuedCompletion(localId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateQueuedCompletionError(localId: string, error: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const record = getReq.result as QueuedCompletion | undefined;
      if (record) {
        record.lastError = error;
        store.put(record);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Attempts to sync every queued completion against the real API, one at a
 * time. Each success removes that entry; each failure is recorded on the
 * entry and left in the queue rather than silently dropped or retried in a
 * tight loop. Returns a summary so the caller can show the result.
 */
export async function syncQueuedCompletions(
  completeFn: (
    pmId: string,
    payload: QueuedCompletion["payload"],
    file: File | null,
    checklistResponses?: QueuedCompletion["checklistResponses"]
  ) => Promise<unknown>
): Promise<{ synced: number; failed: number }> {
  const queued = await listQueuedCompletions();
  let synced = 0;
  let failed = 0;
  for (const entry of queued) {
    try {
      await completeFn(entry.pmId, entry.payload, entry.file, entry.checklistResponses);
      await removeQueuedCompletion(entry.localId);
      synced += 1;
    } catch (err: any) {
      await updateQueuedCompletionError(entry.localId, err?.message || "Sync failed");
      failed += 1;
    }
  }
  return { synced, failed };
}
