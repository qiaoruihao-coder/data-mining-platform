import { Demand, DemandIdParams, type DemandDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";
import { demandAccessFailure } from "./demand-access-recovery";

export async function loadAdminDemandDetail(demandId: DemandDTO["id"]) {
  const params = DemandIdParams.safeParse({ id: demandId });
  if (!params.success) throw new ApiClientError("需求编号无效。", "INVALID_DEMAND_ID", 400);
  const response = await apiGet(`/api/demand/${encodeURIComponent(params.data.id)}`, Demand);
  if (response.data.id !== params.data.id) {
    throw new ApiClientError("需求详情编号与请求不一致。", "INVALID_RESPONSE", 200);
  }
  // 管理视图保留接口返回的全部需求状态；可见范围仍须由服务端鉴权决定。
  return response;
}

export type AdminDemandDetailState =
  | { status: "loading" }
  | { status: "ready"; response: Awaited<ReturnType<typeof loadAdminDemandDetail>> }
  | { status: "not-found" }
  | { status: "error"; message: string; canExitOwnerSession?: boolean };

export function adminDemandDetailFailureState(error: unknown): Extract<AdminDemandDetailState, { status: "not-found" | "error" }> {
  const access = demandAccessFailure(error);
  if (access) return { status: "error", ...access };
  if (error instanceof ApiClientError) {
    if (error.status === 404 && error.code === "DEMAND_NOT_FOUND") return { status: "not-found" };
    const messages: Partial<Record<number, string>> = {
      400: "需求编号无效，请从平台看板或售后工单重新打开。",
      501: "需求详情查询尚未实现，请等待接口接入后重试。",
      503: "需求服务暂时不可用，请稍后重试。",
    };
    const message = messages[error.status];
    if (message) return { status: "error", message };
    if (error.code === "INVALID_RESPONSE") return { status: "error", message: "需求详情格式或编号异常，请稍后重新加载。" };
  }
  return { status: "error", message: "需求详情加载失败，请检查网络或稍后重试。" };
}
