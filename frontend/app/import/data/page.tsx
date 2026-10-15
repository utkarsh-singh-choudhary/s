import DataImportClient from "./DataImportClient";

export const dynamic = "force-dynamic";

export default function DataImportPage({ searchParams }: { searchParams: { kind?: string } }) {
  const kind = searchParams?.kind === "employees" ? "employees" : "spare-parts";
  return <DataImportClient initialKind={kind} />;
}
