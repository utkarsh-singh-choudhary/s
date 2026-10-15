import BreakdownDetailClient from "./BreakdownDetailClient";

export const dynamic = "force-dynamic";

export default function BreakdownDetailPage({ params }: { params: { id: string } }) {
  return <BreakdownDetailClient id={params.id} />;
}
