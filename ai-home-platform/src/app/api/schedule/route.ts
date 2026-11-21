import { handleScheduleCreate } from "@/lib/schedule-create";
import { handleScheduleRead } from "@/lib/schedule-read";
import { handleScheduleRevision } from "@/lib/schedule-revision";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleScheduleRead(request);
}

export function POST(request: Request) {
  return handleScheduleCreate(request);
}

export function PUT(request: Request) {
  return handleScheduleRevision(request);
}
