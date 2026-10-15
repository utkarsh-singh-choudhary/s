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

export default async function SparePartsPage({ searchParams }: { searchParams: { low_stock_only?: string } }) {
  const machines = await safe(() => api.machines(), []);
  return <SparePartsClient machines={machines} initialLowOnly={searchParams.low_stock_only === "true"} />;
}
