import { DemandDetailPanel } from "@/features/a/DemandDetailPanel";

/**
 * 需求详情：按链接里的 ID 从 GET /api/demand 查询（D 尚未提供 /api/demand/[id]）。
 * 查不到时如实提示，不用固定样例冒充该 ID 的数据。
 */
export default function Page({ params }: { params: { id: string } }) {
  return <DemandDetailPanel id={params.id} />;
}
