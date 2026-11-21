import { ChatWindow } from "@/components/ChatWindow";
import { LinkButton, PageHeader } from "@/features/a/ui";

export default function Page() {
  return (
    <>
      <PageHeader
        title="描述装修需求"
        
        aside={<LinkButton href="/owner" variant="secondary">返回业主首页</LinkButton>}
      />
      <ChatWindow />
    </>
  );
}
