import { QuotePage } from "@/features/b/QuotePage";

export default function Page({ params }: { params: { id: string } }) {
  return <QuotePage key={params.id} demandId={params.id} />;
}
