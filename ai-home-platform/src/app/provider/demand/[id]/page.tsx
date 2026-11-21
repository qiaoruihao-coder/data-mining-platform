import { DemandDetail } from "@/features/c/DemandDetail";

export default function Page({ params }: { params: { id: string } }) {
  return <DemandDetail key={params.id} demandId={params.id} />;
}
