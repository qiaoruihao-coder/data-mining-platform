import { createDemoSessionHandlers } from "@/lib/demo-session-handlers";

export const dynamic = "force-dynamic";
export const { GET, POST, DELETE } = createDemoSessionHandlers();
