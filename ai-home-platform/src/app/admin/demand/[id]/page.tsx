import { AdminDemandDetail } from "@/features/c/AdminDemandDetail";

export default function Page({ params }: { params: { id: string } }) {
  return <AdminDemandDetail demandId={params.id} />;
}
