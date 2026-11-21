import { OwnerOrderResult, OrderQuery, type OrderSummaryDTO, type SourceDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

export type OwnerOrderState =
  | { phase: "loading" }
  | { phase: "ready"; order: OrderSummaryDTO | null; source: SourceDTO }
  | { phase: "failed"; error: string };

export function ownerOrderErrorMessage(cause: ApiClientError): string {
  if (cause.status === 401) return "请先登录业主账号，才能读取本人接单。";
  if (cause.status === 403) return "当前账号没有读取这条需求接单的权限。";
  if (cause.status === 404) return "没有找到这条需求的接单关系。";
  if (cause.status === 501) return "接单读取接口尚未开放（HTTP 501），请稍后重试。";
  if (cause.status >= 500 || cause.code === "NETWORK_ERROR") return "接单信息暂时无法读取，请重新加载核实。";
  return `${cause.message}（HTTP ${cause.status}）。`;
}

export async function loadOwnerOrder(demandId: string): Promise<OwnerOrderState> {
  if (!OrderQuery.safeParse({ demandId }).success) return { phase: "failed", error: "需求编号无效，请检查链接。" };
  try {
    const result = await apiGet(`/api/order?demandId=${encodeURIComponent(demandId)}`, OwnerOrderResult);
    if (result.data && result.data.demandId !== demandId) {
      return { phase: "failed", error: "接口返回了另一条需求的接单，已停止展示，请重新加载。" };
    }
    return { phase: "ready", order: result.data, source: result.meta.source };
  } catch (cause) {
    if (cause instanceof ApiClientError) return { phase: "failed", error: ownerOrderErrorMessage(cause) };
    return { phase: "failed", error: "接单信息加载失败，请重新加载。" };
  }
}
