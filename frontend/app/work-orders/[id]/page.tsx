import WorkOrderDetailClient from "./WorkOrderDetailClient";

export const dynamic = "force-dynamic";

export default function WorkOrderDetailPage({ params }: { params: { id: string } }) {
  return <WorkOrderDetailClient id={params.id} />;
}
