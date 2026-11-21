import { Demand, DemandIdParams, Provider, Quote, envelope } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";
import { prepareQuotes } from "@/lib/quote-engine";

export class QuoteDemandNotFound extends Error {
  constructor() {
    super("这份需求不存在或不属于当前业主，请返回需求列表核对。");
    this.name = "QuoteDemandNotFound";
  }
}

/** 先通过报价接口核验业主权限，再读取需求和可选的服务方资料。 */
export async function loadQuoteComparison(demandId: string) {
  const params = DemandIdParams.safeParse({ id: demandId });
  if (!params.success) throw new ApiClientError("需求 ID 无效。", "VALIDATION_ERROR", 400);

  const quotes = await apiGet(`/api/quote?demandId=${encodeURIComponent(params.data.id)}`, Quote.array())
    .catch((error: unknown) => {
      if (error instanceof ApiClientError && error.status === 404 && error.code === "DEMAND_NOT_FOUND") {
        throw new QuoteDemandNotFound();
      }
      throw error;
    });
  if (quotes.data.some(quote => quote.demandId !== demandId || !["submitted", "accepted"].includes(quote.status))) {
    throw new ApiClientError("报价接口返回了不属于本次查询的报价。", "INVALID_RESPONSE", 200);
  }

  const demand = await apiGet(`/api/demand/${encodeURIComponent(params.data.id)}`, Demand)
    .catch((error: unknown) => {
      if (error instanceof ApiClientError && error.status === 404 && error.code === "DEMAND_NOT_FOUND") {
        throw new QuoteDemandNotFound();
      }
      throw error;
    });
  if (demand.data.id !== demandId) {
    throw new ApiClientError("需求接口返回了其他需求。", "INVALID_RESPONSE", 200);
  }

  const visible = prepareQuotes(demandId, quotes.data);
  // 服务方资料仅用于补充名称；失败不能抹掉已通过校验的需求和报价。
  let providerWarning: string | undefined;
  const providers = visible.length ? await apiGet("/api/provider", Provider.array()).catch((error: unknown) => {
    providerWarning = error instanceof ApiClientError && error.status === 501
      ? "服务方资料接口尚未开放，名称待确认。可继续核对报价明细，稍后点击“刷新报价”重试。"
      : "服务方资料读取失败，名称待确认。可继续核对报价明细，点击“刷新报价”重试。";
    return null;
  }) : null;
  const source = demand.meta.source === "live" && demand.data.source === "live" && quotes.meta.source === "live" && visible.every(quote => quote.source === "live") && (!providers || providers.meta.source === "live") ? "live" : "mock";

  return {
    demand: demand.data,
    providers: providers?.data ?? [],
    demandSource: demand.data.source,
    quoteSource: quotes.meta.source,
    providerSource: providers?.meta.source ?? null,
    ...(providerWarning ? { providerWarning } : {}),
    response: envelope(Quote.array()).parse({ ok: true, data: visible, meta: { source } }),
  };
}

export function quoteLoadErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "尚未登录业主账号或登录已失效。请使用页面上方的“业主登录”，登录后点击“重新加载”。";
    if (error.status === 403) return "当前身份无权查看业主报价对比，服务方身份不能读取此列表。请在页面上方登录这份需求所属的业主账号后重新加载；角色切换不等于登录。";
    if (error.status === 501) return "所需接口尚未开放，暂时无法读取报价。";
    if (error.status === 503) return "数据服务暂时不可用，请稍后重试。";
    if (error.code === "NETWORK_ERROR") return "网络请求失败，请检查连接后重试。";
    if (error.code === "INVALID_RESPONSE") return "接口返回的数据不符合约定，暂时无法展示报价。";
  }
  return "报价数据加载失败，请稍后重试。";
}
