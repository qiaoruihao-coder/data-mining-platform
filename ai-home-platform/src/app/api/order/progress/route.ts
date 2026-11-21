import { handleOrderProgress } from "@/lib/order-progress";
import { handleOrderProgressHistory } from "@/lib/order-progress-history";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleOrderProgressHistory(request);
}

export function POST(request: Request) {
  return handleOrderProgress(request);
}
