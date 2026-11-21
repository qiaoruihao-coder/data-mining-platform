import { Demand, Provider, Quote, envelope } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";
import { demoDemand, providers } from "@/lib/mock-data";
import { prepareQuotes } from "@/lib/quote-engine";
import { loadQuoteComparison } from "@/features/b/load-quotes";

export function isFixedDemoQuote(demandId: string) {
  return demandId === demoDemand.id;
}

/** 固定演示独立读取；真实需求的任何失败都不能切换到该分支。 */
export async function loadQuotePageData(demandId: string): Promise<Awaited<ReturnType<typeof loadQuoteComparison>>> {
  if (!isFixedDemoQuote(demandId)) return loadQuoteComparison(demandId);

  const response = await apiGet("/api/quote", Quote.array());
  if (response.meta.source !== "mock" || response.data.some(quote =>
    quote.demandId !== demoDemand.id || quote.source !== "mock" || !["submitted", "accepted"].includes(quote.status))) {
    throw new ApiClientError("演示接口返回了非固定模拟报价，暂时无法展示。", "INVALID_RESPONSE", 200);
  }

  // 不读数据库中的同 ID 需求或服务方；复用共享的只读固定样例。
  return {
    demand: Demand.parse({ ...demoDemand, source: "mock" }),
    providers: Provider.array().parse(providers),
    demandSource: "mock",
    quoteSource: "mock",
    providerSource: "mock",
    response: envelope(Quote.array()).parse({
      ok: true, data: prepareQuotes(demoDemand.id, response.data), meta: { source: "mock" },
    }),
  };
}
