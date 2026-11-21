import { Ticket, TicketCreateInput, type DemandDTO, type TicketCreateInputDTO, type TicketDTO } from "@/contracts";
import { ApiClientError, apiGet, apiPost } from "@/lib/api-client";

export type TicketCreateForm = Pick<TicketCreateInputDTO, "description" | "category">;

export type TicketListResponse = {
  data: TicketDTO[];
  source: "mock" | "live";
};

export type TicketCreateOutcome =
  | { kind: "created"; ticket: TicketDTO; source: "mock" | "live" }
  | { kind: "auth_required"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "uncertain"; message: string; tickets?: TicketListResponse }
  | { kind: "failed"; message: string };

export function formToTicketInput(demandId: DemandDTO["id"], form: TicketCreateForm): TicketCreateInputDTO {
  return TicketCreateInput.parse({
    demandId,
    description: form.description.trim(),
    category: form.category,
  });
}

export async function createTicket(demandId: string, form: TicketCreateForm) {
  const input = formToTicketInput(demandId, form);
  const response = await apiPost("/api/ticket", input, Ticket);
  return { ticket: response.data, source: response.source };
}

export async function loadTickets(demandId: string): Promise<TicketListResponse> {
  const response = await apiGet(`/api/ticket?demandId=${encodeURIComponent(demandId)}`, Ticket.array());
  if (response.data.some((ticket) => ticket.demandId !== demandId)) {
    throw new ApiClientError("接口返回了其他需求的工单。", "INVALID_RESPONSE", 200);
  }
  return { data: response.data, source: response.meta.source };
}

export function ticketErrorMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return "工单服务暂时不可用，请稍后重试。";
  if (error.status === 401) return "请先完成业主登录，再提交售后工单。已填写内容会保留。";
  if (error.status === 403) return "当前账号没有提交这条需求售后工单的权限。";
  if (error.status === 404) return "未找到这条需求，无法提交售后工单。";
  if (error.status === 409) {
    if (error.code === "DEMO_DEMAND_READ_ONLY") return "模拟需求仅供查看，不能创建真实售后工单。";
    return "当前需求状态不允许创建售后工单。";
  }
  if (error.status === 503) return "工单服务暂时不可用，已停止自动重试。请核对下方工单列表后再决定是否处理。";
  if (error.status === 501) return "售后工单接口尚未开放，请稍后重试。";
  if (error.code === "NETWORK_ERROR" || error.status === 0) return "网络状态不确定，已停止自动重试。请核对下方工单列表。";
  return `${error.message}（${error.code}）`;
}

/**
 * 工单列表是“本人需求”的权限预检。
 * 公开需求对匿名用户和其他业主仍可读，但他们不应看到工单写入面板。
 */
export function isTicketAccessDenied(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 401 || error.status === 403 || error.status === 404);
}

export function isUncertainTicketError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 503 || error.status === 0 || error.code === "NETWORK_ERROR");
}

export async function submitTicket(demandId: string, form: TicketCreateForm): Promise<TicketCreateOutcome> {
  try {
    const result = await createTicket(demandId, form);
    return { kind: "created", ...result };
  } catch (error) {
    if (isUncertainTicketError(error)) {
      try {
        const tickets = await loadTickets(demandId);
        return { kind: "uncertain", message: ticketErrorMessage(error), tickets };
      } catch {
        return { kind: "uncertain", message: `${ticketErrorMessage(error)} 当前也无法读取工单列表。` };
      }
    }
    if (error instanceof ApiClientError) {
      if (error.status === 401) return { kind: "auth_required", message: ticketErrorMessage(error) };
      if (error.status === 403) return { kind: "forbidden", message: ticketErrorMessage(error) };
      if (error.status === 404) return { kind: "not_found", message: ticketErrorMessage(error) };
      if (error.status === 409) return { kind: "conflict", message: ticketErrorMessage(error) };
    }
    return { kind: "failed", message: ticketErrorMessage(error) };
  }
}

export function categoryLabel(category: TicketDTO["category"]): string {
  return {
    quality: "质量问题",
    schedule: "进度问题",
    payment: "付款问题",
    attitude: "服务态度",
  }[category];
}

export function statusLabel(status: TicketDTO["status"]): string {
  return { open: "待处理", assigned: "已分派", resolved: "已解决" }[status];
}
