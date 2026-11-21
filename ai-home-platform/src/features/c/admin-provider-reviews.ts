import { Provider, ProviderQuery, type ProviderDTO, type SourceDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

export const reviewSourceLabels: Record<SourceDTO, string> = {
  live: "实际记录（live）", mock: "模拟记录（mock）",
};

export const reviewSampleOptions = ["all", "with_reviews", "no_reviews", "unknown"] as const;
export type AdminProviderReviewFilters = {
  keyword: string;
  sampleState: typeof reviewSampleOptions[number];
};
export const reviewSampleLabels: Record<AdminProviderReviewFilters["sampleState"], string> = {
  all: "全部样本状态", with_reviews: "已有评价", no_reviews: "暂无样本", unknown: "汇总未知",
};
export const defaultAdminProviderReviewFilters: AdminProviderReviewFilters = { keyword: "", sampleState: "all" };

export function filterAdminProviderReviews(providers: readonly ProviderDTO[], filters: AdminProviderReviewFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  return providers.filter(provider => {
    const sampleState = provider.performance == null ? "unknown"
      : provider.performance.reviewCount === 0 ? "no_reviews" : "with_reviews";
    return (filters.sampleState === "all" || filters.sampleState === sampleState)
      && (!keyword || [provider.id, provider.name, provider.city].some(value => value.toLowerCase().includes(keyword)));
  });
}

export async function loadAdminProviderReviews(source: SourceDTO) {
  const query = ProviderQuery.safeParse({ performanceSource: source });
  if (!query.success) throw new ApiClientError("评价来源无效。", "INVALID_QUERY", 400);
  const response = await apiGet(`/api/provider?performanceSource=${query.data.performanceSource}`, Provider.array());
  if (new Set(response.data.map(provider => provider.id)).size !== response.data.length
    || response.data.some(provider => provider.performance && provider.performance.source !== query.data.performanceSource)) {
    throw new ApiClientError("服务方编号或评价来源不符合本次查询。", "INVALID_RESPONSE", 200);
  }
  return response;
}

export type AdminProviderReviewsState =
  | { status: "loading" }
  | { status: "ready"; response: Awaited<ReturnType<typeof loadAdminProviderReviews>> }
  | { status: "error"; message: string };

export function adminProviderReviewsFailure(error: unknown): Extract<AdminProviderReviewsState, { status: "error" }> {
  if (error instanceof ApiClientError) {
    if (error.status === 501) return { status: "error", message: "服务方评价汇总尚未实现，暂时无法展示。" };
    if (error.status === 503) return { status: "error", message: "服务方评价汇总暂时不可用，请稍后重新加载。" };
    if (error.status === 401 || error.status === 403) return { status: "error", message: "本次评价汇总请求未获授权，请联系维护者核实。角色切换不能授予访问权限。" };
    if (error.code === "INVALID_RESPONSE" && error.status >= 200 && error.status < 300) return { status: "error", message: "评价汇总格式、编号或来源异常，请稍后重新加载。" };
  }
  return { status: "error", message: "评价汇总加载失败，请检查网络或重新选择来源后重试。" };
}
