import { OrderSummary, type OrderSummaryDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

export const serviceOrderStatusLabels: Record<OrderSummaryDTO["status"], string> = {
  contracted: "已建立接单关系",
  in_progress: "进行中",
  completed: "已完成",
};

export type ServiceOrderStatusFilter = "all" | OrderSummaryDTO["status"];
export const serviceOrderFilterOptions = ["all", ...OrderSummary.shape.status.options] as const;
export const serviceOrderFilterLabels: Record<ServiceOrderStatusFilter, string> = {
  all: "全部接单",
  ...serviceOrderStatusLabels,
};

export function summarizeServiceOrders(orders: readonly OrderSummaryDTO[]) {
  const byStatus: Record<OrderSummaryDTO["status"], number> = { contracted: 0, in_progress: 0, completed: 0 };
  for (const order of orders) byStatus[order.status] += 1;
  return { total: orders.length, byStatus };
}

export function filterServiceOrders(orders: readonly OrderSummaryDTO[], status: ServiceOrderStatusFilter) {
  return orders.filter(order => status === "all" || order.status === status);
}

export async function loadProviderServiceOrders() {
  const response = await apiGet("/api/provider/orders", OrderSummary.array());
  // 当前契约每个需求和被接受报价只能对应一条关系，不能静默合并坏记录。
  for (const field of ["id", "demandId", "acceptedQuoteId"] as const) {
    if (new Set(response.data.map(order => order[field])).size !== response.data.length) {
      throw new ApiClientError("接单列表包含重复关联。", "INVALID_RESPONSE", 200);
    }
  }
  return response;
}

export type ProviderServiceOrdersState =
  | { status: "loading" }
  | { status: "ready"; response: Awaited<ReturnType<typeof loadProviderServiceOrders>> }
  | { status: "error"; message: string };

export function providerServiceOrdersErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "尚未登录服务方账号或登录已失效。请使用页面上方的“演示服务方登录”，登录后重新加载接单；演示登录未开启时请联系维护者。";
    if (error.status === 403) return "当前身份无权查看本人接单，业主登录不能代替服务方登录。请完成演示服务方登录后重新加载接单。";
    if (error.status === 501) return "本人接单查询尚未实现，暂时无法展示记录。";
    if (error.status === 503) return "本人接单服务暂时不可用，请稍后重试。";
    if (error.code === "INVALID_RESPONSE") return "本人接单数据格式异常，请稍后重新加载。";
  }
  return "本人接单加载失败，请检查网络或稍后重试。";
}
