import { handleProviderDirectory } from "@/lib/provider-directory";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleProviderDirectory(request); }
