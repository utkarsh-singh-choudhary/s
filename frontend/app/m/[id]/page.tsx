import { redirect } from "next/navigation";

// Target of the QR codes stuck on machines: /m/<machine id>. Not signed in?
// middleware.ts sends the person to /login first and brings them back here.
export default function MachineScanPage({ params }: { params: { id: string } }) {
  redirect(`/machines/${encodeURIComponent(params.id)}`);
}
