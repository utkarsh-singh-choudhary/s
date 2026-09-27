import { api } from "@/lib/api";
import MachinesClient from "./MachinesClient";

export const dynamic = "force-dynamic";

export default async function MachinesPage() {
  let machines: Awaited<ReturnType<typeof api.machines>> = [];
  try {
    machines = await api.machines();
  } catch {
    machines = [];
  }

  return <MachinesClient machines={machines} />;
}
