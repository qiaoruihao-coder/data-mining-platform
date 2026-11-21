import React from "react";
import Link from "next/link";
import { AdminDemandOverview } from "@/features/c/AdminDemandOverview";

export default function Page() {
  return <div className="space-y-6">
    <nav aria-label="管理看板功能">
      <Link href="/admin/provider-reviews" className="text-[15px] font-medium hover:underline">查看服务方评价汇总</Link>
    </nav>
    <AdminDemandOverview />
  </div>;
}
