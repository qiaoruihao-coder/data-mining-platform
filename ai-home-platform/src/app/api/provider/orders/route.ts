import { handleProviderOrders } from "@/lib/order";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleProviderOrders(request);
}
