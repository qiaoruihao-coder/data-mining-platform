import { MatchPage } from "@/features/b/MatchPage";

export default function Page({ params }: { params: { id: string } }) {
  return <MatchPage key={params.id} demandId={params.id} />;
}
