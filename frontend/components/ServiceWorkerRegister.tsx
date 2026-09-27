"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline caching is a nice-to-have, not load-bearing — if registration
      // fails (unsupported browser, blocked, etc.) the app still works fully
      // online, so we swallow the error rather than surface it to the user.
    });
  }, []);
  return null;
}
