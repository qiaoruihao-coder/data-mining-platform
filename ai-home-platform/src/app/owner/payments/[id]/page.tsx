import { PaymentsPanel } from "@/features/a/PaymentsPanel";

export default function Page({ params }: { params: { id: string } }) {
  return <PaymentsPanel id={params.id} />;
}
