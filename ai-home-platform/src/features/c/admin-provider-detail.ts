import { Provider, type ProviderDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

export const providerKindLabels: Record<ProviderDTO["kind"], string> = {
  construction: "施工服务", materials: "材料供应", design: "设计服务", supervision: "监理服务",
};

export async function loadAdminProviderDetail(providerId: ProviderDTO["id"]) {
  const id = Provider.shape.id.safeParse(providerId);
  if (!id.success) throw new ApiClientError("服务方编号无效。", "INVALID_PROVIDER_ID", 400);
  // The shared API currently exposes a public list, not an individual-provider endpoint.
  const response = await apiGet("/api/provider", Provider.array());
  if (new Set(response.data.map(provider => provider.id)).size !== response.data.length) {
    throw new ApiClientError("服务方资料包含重复编号。", "INVALID_RESPONSE", 200);
  }
  // Preserve exact IDs. Missing profiles must never fall back to the first/demo provider.
  return { provider: response.data.find(provider => provider.id === id.data) ?? null, source: response.meta.source };
}

export type AdminProviderDetailState =
  | { status: "loading" }
  | { status: "ready"; result: Awaited<ReturnType<typeof loadAdminProviderDetail>> }
  | { status: "error"; message: string };

export function adminProviderDetailFailureState(error: unknown): Extract<AdminProviderDetailState, { status: "error" }> {
  if (error instanceof ApiClientError) {
    if (error.code === "INVALID_PROVIDER_ID") return { status: "error", message: "服务方编号无效，请从售后工单重新打开资料。" };
    if (error.status === 401) return { status: "error", message: "服务方资料读取的身份验证未通过，请重新加载或联系维护者核实。角色导航不能代替登录。" };
    if (error.status === 403) return { status: "error", message: "当前请求无权查看服务方资料，请联系维护者核实访问权限。" };
    if (error.status === 501) return { status: "error", message: "服务方资料查询尚未实现，暂时无法查看。" };
    if (error.status === 503) return { status: "error", message: "服务方资料服务暂时不可用，请稍后重试。" };
    if (error.code === "INVALID_RESPONSE") return { status: "error", message: "服务方资料格式或编号异常，请稍后重新加载。" };
  }
  // A failed list request (including HTTP 404) cannot establish that a provider is absent.
  return { status: "error", message: "服务方资料加载失败，请检查网络或稍后重试。" };
}
