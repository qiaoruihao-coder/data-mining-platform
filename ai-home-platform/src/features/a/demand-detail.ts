import { Demand, DemandIdParams } from "@/contracts";
import type { DemandDTO } from "@/contracts";
import { ApiClientError, apiGet } from "@/lib/api-client";
import type { EnvelopeSource } from "./demand-chat";

export type DemandDetailState =
  | { phase: "loading" }
  | { phase: "ready"; demand: DemandDTO; source: EnvelopeSource }
  | { phase: "missing" }
  | { phase: "failed"; error: string };

export function detailErrorMessage(error: ApiClientError): string {
  const detail = `（${error.code}，HTTP ${error.status}）`;
  if (error.status === 401) return `请先登录后查看这条需求。${detail}`;
  if (error.status === 403) return `没有权限查看这条需求。${detail}`;
  if (error.status === 400) return `需求编号无效，请检查链接。${detail}`;
  if (error.status === 501) return `需求详情接口尚未开放，请稍后重试。${detail}`;
  if (error.status >= 500) return `需求服务暂时不可用，请稍后重试。${detail}`;
  if (error.code === "NETWORK_ERROR") return "网络请求失败，请检查连接后重试。";
  return `${error.message}（${error.code}）`;
}

/** 只读取指定 ID；拒绝错误响应和错位数据，不用列表或演示记录掩盖失败。 */
export async function loadDemandDetail(id: string): Promise<DemandDetailState> {
  if (!DemandIdParams.safeParse({ id }).success) {
    return { phase: "failed", error: "需求编号无效，请检查链接。" };
  }
  try {
    const result = await apiGet(`/api/demand/${encodeURIComponent(id)}`, Demand);
    if (result.data.id !== id) {
      return { phase: "failed", error: "接口返回了另一条需求，已停止展示，请重试或检查链接。" };
    }
    return { phase: "ready", demand: result.data, source: result.meta.source };
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      if (cause.status === 404) return { phase: "missing" };
      return { phase: "failed", error: detailErrorMessage(cause) };
    }
    return { phase: "failed", error: "需求详情加载失败，请重试。" };
  }
}
