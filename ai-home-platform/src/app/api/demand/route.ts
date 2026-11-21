import { handleDemandList } from "@/lib/demand-read";
import { handleDemandCreate } from "@/lib/demand-create";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleDemandList(request);
}

export async function POST(request: Request) {
  return handleDemandCreate(request);
}
