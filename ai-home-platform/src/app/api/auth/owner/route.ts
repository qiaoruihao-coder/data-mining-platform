import { createOwnerSessionHandlers } from "@/lib/owner-session-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { GET, POST, DELETE } = createOwnerSessionHandlers();
