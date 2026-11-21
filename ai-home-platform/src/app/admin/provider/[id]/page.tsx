import React from "react";
import { AdminProviderDetail } from "@/features/c/AdminProviderDetail";

export default function Page({ params }: { params: { id: string } }) {
  // Next 14 supplies encoded App Router params. Decode exactly once so literal %2F IDs stay distinct from /.
  return <AdminProviderDetail providerId={decodeURIComponent(params.id)} />;
}
