import { Ticket } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

// 字段类型直接从公共 Ticket Schema 推导，不维护另一套工单 DTO。
export const ticketCategoryLabels: Record<ReturnType<typeof Ticket.parse>["category"], string> = {
  quality: "质量问题",
  schedule: "工期问题",
  payment: "费用问题",
  attitude: "服务态度",
};
export const ticketStatusLabels: Record<ReturnType<typeof Ticket.parse>["status"], string> = {
  open: "待处理",
  assigned: "已分派",
  resolved: "已解决",
};

export type TicketDTO = ReturnType<typeof Ticket.parse>;
export type TicketCategoryFilter = "all" | TicketDTO["category"];
export type TicketStatusFilter = "all" | TicketDTO["status"];

export function summarizeTickets(tickets: readonly TicketDTO[]) {
  const statusCounts = (): Record<TicketDTO["status"], number> => ({ open: 0, assigned: 0, resolved: 0 });
  const byCategory: Record<TicketDTO["category"], ReturnType<typeof statusCounts>> = {
    quality: statusCounts(), schedule: statusCounts(), payment: statusCounts(), attitude: statusCounts(),
  };
  const byStatus = statusCounts();
  for (const ticket of tickets) {
    byCategory[ticket.category][ticket.status] += 1;
    byStatus[ticket.status] += 1;
  }
  return { total: tickets.length, byCategory, byStatus };
}

export const ticketCategoryFilterOptions = ["all", ...Ticket.shape.category.options] as const;
export const ticketStatusFilterOptions = ["all", ...Ticket.shape.status.options] as const;
export const ticketCategoryFilterLabels: Record<TicketCategoryFilter, string> = {
  all: "全部分类",
  ...ticketCategoryLabels,
};
export const ticketStatusFilterLabels: Record<TicketStatusFilter, string> = {
  all: "全部状态",
  ...ticketStatusLabels,
};

export function filterTickets(tickets: TicketDTO[], category: TicketCategoryFilter, status: TicketStatusFilter, query = "") {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return tickets.filter((ticket) =>
    (category === "all" || ticket.category === category) &&
    (status === "all" || ticket.status === status) &&
    (!normalizedQuery || [ticket.id, ticket.demandId, ticket.responsibleProviderId ?? ""]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))),
  );
}

export async function loadAdminTickets() {
  const response = await apiGet("/api/ticket", Ticket.array());
  if (new Set(response.data.map((ticket) => ticket.id)).size !== response.data.length) {
    throw new ApiClientError("工单列表包含重复编号。", "INVALID_RESPONSE", 200);
  }
  return response;
}

export type AdminTicketsState =
  | { status: "loading" }
  | { status: "ready"; response: Awaited<ReturnType<typeof loadAdminTickets>> }
  | { status: "error"; message: string; canExitOwnerSession?: boolean };

export function adminTicketsFailureState(error: unknown): Extract<AdminTicketsState, { status: "error" }> {
  return {
    status: "error",
    message: adminTicketsErrorMessage(error),
    // The current no-parameter ticket endpoint checks an existing owner cookie.
    // Unknown authentication errors must not suggest clearing that session.
    canExitOwnerSession: error instanceof ApiClientError && (
      (error.status === 401 && error.code === "UNAUTHENTICATED") ||
      (error.status === 403 && error.code === "FORBIDDEN")
    ),
  };
}

export function adminTicketsErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401 && error.code === "UNAUTHENTICATED") {
      return "业主登录已失效，当前工单未能读取。可在页面上方重新登录业主后点击“重新加载”，或退出业主会话后重新查询固定模拟工单。服务方登录和角色导航不能解除此问题。";
    }
    if (error.status === 403 && error.code === "FORBIDDEN") {
      return "当前身份无权查看售后工单，业主账号权限可能已变更。可退出业主会话后重新查询固定模拟工单；如需以业主身份访问，请联系维护者核实账号权限。";
    }
    if (error.status === 401) return "工单读取的身份验证未通过，请重新加载；角色导航不能代替登录。";
    if (error.status === 403) return "当前身份无权查看售后工单，请联系维护者核实访问权限。";
    if (error.status === 501) return "工单查询尚未实现，暂时无法展示列表。";
    if (error.status === 503) return "工单服务暂时不可用，请稍后重试。";
    if (error.code === "INVALID_RESPONSE") return "工单数据格式异常，请稍后重新加载。";
  }
  return "工单加载失败，请检查网络或稍后重试。";
}
