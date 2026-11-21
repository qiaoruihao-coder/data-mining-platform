import { Demand, DemandDeleteResult, DemandIdParams } from "@/contracts";
import type { DemandDTO, DemandDeleteResultDTO, SourceDTO } from "@/contracts";
import { ApiClientError, apiDelete, apiPut } from "@/lib/api-client";
import { formToInput, type DemandForm } from "./demand-chat";

export type DemandMutationOutcome =
  | { kind: "updated"; demand: DemandDTO; source: SourceDTO }
  | { kind: "deleted"; result: DemandDeleteResultDTO; source: SourceDTO }
  | { kind: "rejected"; messages: string[] }
  | { kind: "failed"; message: string; status: number; code: string };

function failureMessage(status: number, code: string, message: string) {
  if (status === 501) return `需求修改接口尚未开放（${code}）：${message}`;
  if (status === 409) return `当前需求状态不允许修改（${code}）：${message}`;
  if (status === 401) return `请先完成业主登录后再修改需求（${code}）。`;
  if (status === 403) return `没有权限修改这条需求（${code}）。`;
  if (status >= 500) return `需求服务暂时不可用（${code}）：${message}`;
  return `${message}（${code}，HTTP ${status}）`;
}

function parseMutationFailure(cause: unknown): DemandMutationOutcome {
  if (cause instanceof ApiClientError) {
    return {
      kind: "failed",
      message: cause.code === "NETWORK_ERROR"
        ? "网络请求失败，请检查连接后重试。"
        : failureMessage(cause.status, cause.code, cause.message),
      status: cause.status,
      code: cause.code,
    };
  }
  return { kind: "failed", message: "未收到有效的接口结果，请刷新详情后再试。", status: 0, code: "UNKNOWN_ERROR" };
}

export function demandCanMutate(demand: DemandDTO): boolean {
  return demand.id !== "demo-demand" && (demand.status === "draft" || demand.status === "published");
}

export function demandFormFromDetail(demand: DemandDTO): DemandForm {
  return {
    description: demand.description,
    city: demand.city,
    areaM2: String(demand.areaM2),
    budgetMinYuan: (demand.budgetMinCents / 100).toFixed(2).replace(/\.00$/, ""),
    budgetMaxYuan: (demand.budgetMaxCents / 100).toFixed(2).replace(/\.00$/, ""),
    renovationType: demand.renovationType,
    desiredDays: String(demand.desiredDays),
  };
}

export async function updateDemand(id: string, form: DemandForm): Promise<DemandMutationOutcome> {
  const params = DemandIdParams.safeParse({ id });
  if (!params.success) return { kind: "rejected", messages: ["需求编号无效，请检查链接。"] };
  const checked = formToInput(form);
  if (!checked.ok) return { kind: "rejected", messages: checked.messages };

  try {
    // 在公共契约上增加当前需求核对，校验失败仍由共享客户端保留 HTTP 状态。
    const response = await apiPut(
      `/api/demand/${encodeURIComponent(id)}`,
      checked.value,
      Demand.refine(data => data.id === id),
    );
    return { kind: "updated", demand: response.data, source: response.source };
  } catch (cause) {
    return parseMutationFailure(cause);
  }
}

export async function deleteDemand(id: string): Promise<DemandMutationOutcome> {
  const params = DemandIdParams.safeParse({ id });
  if (!params.success) return { kind: "rejected", messages: ["需求编号无效，请检查链接。"] };

  try {
    const response = await apiDelete(
      `/api/demand/${encodeURIComponent(id)}`,
      DemandDeleteResult.refine(data => data.id === id),
    );
    return { kind: "deleted", result: response.data, source: response.source };
  } catch (cause) {
    return parseMutationFailure(cause);
  }
}
