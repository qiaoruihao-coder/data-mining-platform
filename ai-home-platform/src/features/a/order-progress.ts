import {
  OrderProgressInput,
  OrderProgressResult,
  type OrderProgressInputDTO,
  type OrderProgressResultDTO,
  type OrderSummaryDTO,
  type ScheduleDTO,
  type SourceDTO,
} from "@/contracts";
import { apiPost, ApiClientError } from "@/lib/api-client";

export type ProgressAction = OrderProgressInputDTO["action"];

export const PROGRESS_ACTION_LABEL: Record<ProgressAction, string> = {
  start: "确认开工",
  start_task: "开始工序",
  complete_task: "确认工序完成",
  complete: "确认完工",
};

export type ProgressActionCandidate = {
  action: ProgressAction;
  taskId?: string;
  label: string;
  description: string;
};

export function progressActionDescription(action: ProgressAction, taskName?: string): string {
  if (action === "start") return "确认后将接单状态推进为施工中。";
  if (action === "start_task") return `确认后将「${taskName ?? "该工序"}」标记为进行中。`;
  if (action === "complete_task") return `确认后将「${taskName ?? "该工序"}」标记为已完成。该操作不等于专业验收。`;
  return "确认后将整单标记为已完成；这不代表付款完成或专业验收通过。";
}

function dependenciesDone(schedule: ScheduleDTO, task: ScheduleDTO["tasks"][number]): boolean {
  return task.dependsOn.every((dependencyId) =>
    schedule.tasks.find((candidate) => candidate.id === dependencyId)?.status === "done",
  );
}

/** 只返回服务端允许的最小动作集合，页面不凭状态猜测可跳级操作。 */
export function availableProgressActions(
  order: OrderSummaryDTO,
  schedule: ScheduleDTO | null,
): ProgressActionCandidate[] {
  const actions: ProgressActionCandidate[] = [];
  if (order.status === "contracted" && (!schedule || schedule.tasks.every((task) => task.status === "pending"))) {
    actions.push({
      action: "start",
      label: PROGRESS_ACTION_LABEL.start,
      description: progressActionDescription("start"),
    });
  }
  if (order.status !== "in_progress" || !schedule) {
    if (order.status === "in_progress" && !schedule) {
      actions.push({
        action: "complete",
        label: PROGRESS_ACTION_LABEL.complete,
        description: progressActionDescription("complete"),
      });
    }
    return actions;
  }

  for (const task of schedule.tasks) {
    if (task.status === "pending" && dependenciesDone(schedule, task)) {
      actions.push({
        action: "start_task",
        taskId: task.id,
        label: `${PROGRESS_ACTION_LABEL.start_task}：${task.name}`,
        description: progressActionDescription("start_task", task.name),
      });
    }
  }
  for (const task of schedule.tasks) {
    if (task.status === "active" && dependenciesDone(schedule, task)) {
      actions.push({
        action: "complete_task",
        taskId: task.id,
        label: `${PROGRESS_ACTION_LABEL.complete_task}：${task.name}`,
        description: progressActionDescription("complete_task", task.name),
      });
    }
  }
  if (schedule.tasks.length > 0 && schedule.tasks.every((task) => task.status === "done")) {
    actions.push({
      action: "complete",
      label: PROGRESS_ACTION_LABEL.complete,
      description: progressActionDescription("complete"),
    });
  }
  return actions;
}

export function buildOrderProgressInput(
  demandId: string,
  orderId: string,
  schedule: ScheduleDTO | null,
  candidate: Pick<ProgressActionCandidate, "action" | "taskId">,
): OrderProgressInputDTO {
  const input: Record<string, unknown> = {
    demandId,
    orderId,
    confirmed: true,
    scheduleVersion: schedule?.version ?? null,
    action: candidate.action,
  };
  if (candidate.taskId !== undefined) input.taskId = candidate.taskId;
  const parsed = OrderProgressInput.safeParse(input);
  if (!parsed.success) throw new Error("履约推进参数不符合公共契约。");
  return parsed.data;
}

export type OrderProgressResponse = {
  data: OrderProgressResultDTO;
  source: SourceDTO;
};

export async function submitOrderProgress(
  demandId: string,
  orderId: string,
  schedule: ScheduleDTO | null,
  candidate: Pick<ProgressActionCandidate, "action" | "taskId">,
): Promise<OrderProgressResponse> {
  const input = buildOrderProgressInput(demandId, orderId, schedule, candidate);
  return apiPost("/api/order/progress", input, OrderProgressResult);
}

export function orderProgressErrorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError) {
    if (cause.status === 401) return "请先登录业主账号，再确认履约推进。";
    if (cause.status === 403) return "当前账号没有确认这条履约的权限。";
    if (cause.status === 404) return "没有找到对应的接单关系，请刷新需求详情核实。";
    if (cause.status === 409) return "需求或排期版本已变化，请重新加载核实后再操作；本次没有自动重发。";
    if (cause.status === 501) return "履约推进接口尚未开放（HTTP 501），本次没有当作成功。";
    if (cause.status === 503 || cause.code === "NETWORK_ERROR") return "暂时无法确认更新结果，请重新加载需求和排期核实；本次没有自动重发。";
    return `${cause.message}（HTTP ${cause.status}）。`;
  }
  return "暂时无法确认更新结果，请重新加载需求和排期核实；本次没有自动重发。";
}
