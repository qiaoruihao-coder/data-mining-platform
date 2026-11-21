import { handleTicketCreate, handleTicketRead } from "@/lib/ticket";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleTicketRead(request);
}

export function POST(request: Request) {
  return handleTicketCreate(request);
}
