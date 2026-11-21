import { OrderQuery, OwnerOrderResult } from "@/contracts";
import { apiGet, ApiClientError } from "@/lib/api-client";
import type { QuoteComparisonData } from "@/features/b/accept-quote";

/** 接单核实只读；报价 accepted 本身不能证明存在接单关系。 */
export async function loadAcceptedOrder(comparison: QuoteComparisonData) {
  const { demandId } = OrderQuery.parse({ demandId: comparison.demand.id });
  const result = await apiGet(`/api/order?demandId=${encodeURIComponent(demandId)}`, OwnerOrderResult);
  const order = result.data;
  if (order === null) {
    if (!["draft", "published"].includes(comparison.demand.status)
      || (comparison.demand.source !== undefined && result.meta.source !== comparison.demand.source)) {
      throw new ApiClientError("需求已进入接单阶段，但未读到接单关系，请刷新核实。", "INVALID_RESPONSE", 200);
    }
    return result;
  }
  const accepted = comparison.response.data.filter(quote => quote.status === "accepted");
  if (order.demandId !== demandId || order.status !== comparison.demand.status
    || result.meta.source !== order.source || accepted.length !== 1
    || accepted[0].id !== order.acceptedQuoteId || accepted[0].demandId !== demandId
    || accepted[0].providerId !== order.providerId || accepted[0].source !== order.source) {
    throw new ApiClientError("接单与本次读取的需求、报价或来源不一致，请刷新核实。", "INVALID_RESPONSE", 200);
  }
  return result;
}

export function acceptedOrderErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "业主登录已失效，无法核实接单。请重新登录后刷新报价。";
    if (error.status === 403) return "当前身份无权核实接单，请使用所属业主账号登录后刷新报价。";
    if (error.status === 404) return "需求不存在或不属于当前业主，无法核实接单。";
    if (error.status === 501) return "接单读取接口尚未开放，暂时无法核实实际接单关系。";
    if (error.code === "INVALID_RESPONSE") return "接单回读与需求或报价不一致，或格式不符合约定，请刷新报价重新核实。";
  }
  return "接单读取失败，结果仍待核实。请稍后刷新报价；读取失败不等于没有接单。";
}
