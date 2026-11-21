import { SchedulePanel } from "@/features/a/SchedulePanel";

export default function Page({ params }: { params: { id: string } }) {
  return <SchedulePanel id={params.id} />;
}
