import { handleProviderQuotes } from "@/lib/provider-quotes";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleProviderQuotes(request);
}
