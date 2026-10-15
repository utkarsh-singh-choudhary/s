import PMDetailClient from "./PMDetailClient";

export const dynamic = "force-dynamic";

export default function PMDetailPage({ params }: { params: { id: string } }) {
  return <PMDetailClient pmId={params.id} />;
}
