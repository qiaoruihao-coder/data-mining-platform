import { handleDemandDelete } from "@/lib/demand-delete";
import { handleDemandDetail } from "@/lib/demand-read";
import { handleDemandUpdate } from "@/lib/demand-update";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  return handleDemandDetail(request, params.id);
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  return handleDemandUpdate(request, params.id);
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  return handleDemandDelete(request, params.id);
}
