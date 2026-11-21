import { Quote, type QuoteDTO } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";

export const providerOrderStatusLabels: Record<QuoteDTO["status"], string> = {
  draft: "草稿报价",
  submitted: "报价已提交",
  accepted: "报价已接受",
  rejected: "报价已拒绝",
};

export type ProviderQuoteFilters = { status: "all" | QuoteDTO["status"]; keyword: string };
export const providerQuoteStatusOptions = ["all", ...Quote.shape.status.options] as const;
export const defaultProviderQuoteFilters: ProviderQuoteFilters = { status: "all", keyword: "" };

export function filterProviderQuotes(quotes: readonly QuoteDTO[], filters: ProviderQuoteFilters) {
  const keyword = filters.keyword.trim().toLowerCase();
  return quotes.filter(quote =>
    (filters.status === "all" || quote.status === filters.status)
    && (!keyword || [quote.id, quote.demandId].some(id => id.toLowerCase().includes(keyword))),
  );
}

export async function loadProviderOrders() {
  const response = await apiGet("/api/provider/quotes", Quote.array());
  if (new Set(response.data.map((quote) => quote.id)).size !== response.data.length) {
    throw new ApiClientError("报价列表包含重复编号。", "INVALID_RESPONSE", 200);
  }
  return response;
}

export function summarizeProviderOrders(quotes: readonly QuoteDTO[]) {
  return quotes.reduce(
    (summary, quote) => {
      summary[quote.status] += 1;
      return summary;
    },
    { draft: 0, submitted: 0, accepted: 0, rejected: 0 },
  );
}

export type ProviderOrdersState =
  | { status: "loading" }
  | { status: "ready"; response: Awaited<ReturnType<typeof loadProviderOrders>> }
  | { status: "error"; message: string };

export function providerOrdersErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "尚未登录服务方账号或登录已失效。请使用页面上方的“演示服务方登录”，登录后点击“重新加载”；演示登录未开启时请联系维护者。角色导航不能代替登录。";
    if (error.status === 403) return "当前身份无权查看本人报价，业主登录不能代替服务方登录。请完成页面上方的“演示服务方登录”后重新加载。";
    if (error.status === 501) return "本人报价查询尚未实现，暂时无法展示记录。";
    if (error.status === 503) return "本人报价服务暂时不可用，请稍后重试。";
    if (error.code === "INVALID_RESPONSE") return "本人报价数据格式异常，请稍后重新加载。";
  }
  return "本人报价加载失败，请检查网络或稍后重试。";
}
