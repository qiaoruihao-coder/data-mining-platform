import { handleInspectionUpload } from "@/lib/inspection-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleInspectionUpload(request); }
