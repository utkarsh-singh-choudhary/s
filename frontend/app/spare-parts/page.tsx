import { api } from "@/lib/api";
import SparePartsClient from "./SparePartsClient";

export const dynamic = "force-dynamic";

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export default async function SparePartsPage() {
  const parts = await safe(() => api.spareParts(), []);
  return <SparePartsClient initialParts={parts} />;
}
