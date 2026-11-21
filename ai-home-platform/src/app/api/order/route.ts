import { handleOrderAccept, handleOwnerOrderRead } from "@/lib/order";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleOwnerOrderRead(request);
}
export async function POST(request: Request) {
  return handleOrderAccept(request);
}
