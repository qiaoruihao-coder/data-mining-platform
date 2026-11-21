import { OrderProgressEvent, OrderQuery, type OrderProgressEventDTO, type SourceDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

export type OrderProgressHistoryState =
  | { phase: "loading" }
  | { phase: "ready"; events: OrderProgressEventDTO[]; source: SourceDTO }
  | { phase: "failed"; error: string };

export const ORDER_PROGRESS_HISTORY_LOADING: OrderProgressHistoryState = { phase: "loading" };

export function orderProgressHistoryErrorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError) {
    if (cause.status === 401) return "请先登录业主账号，才能读取履约记录。";
    if (cause.status === 403) return "当前账号没有读取这条需求履约记录的权限。";
    if (cause.status === 404) return "没有找到这条需求的履约记录。";
    if (cause.status === 503 || cause.code === "NETWORK_ERROR") return "履约记录暂时无法读取，请重新加载核实。";
  }
  return "履约记录加载失败，请重新加载核实。";
}
export async function loadOrderProgressHistory(demandId: string): Promise<OrderProgressHistoryState> {
  if (!OrderQuery.safeParse({ demandId }).success) return { phase: "failed", error: "需求编号无效，请检查链接。" };
  try {
    const result = await apiGet(`/api/order/progress?demandId=${encodeURIComponent(demandId)}`, OrderProgressEvent.array());
    return { phase: "ready", events: result.data, source: result.meta.source };
  } catch (cause) {
    return { phase: "failed", error: orderProgressHistoryErrorMessage(cause) };
  }
}
