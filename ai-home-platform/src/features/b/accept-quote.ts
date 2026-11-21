import { OrderAcceptInput, OrderSummary, type QuoteDTO } from "@/contracts";
import { apiPost, ApiClientError } from "@/lib/api-client";
import type { loadQuoteComparison } from "@/features/b/load-quotes";
import { isFixedDemoQuote } from "@/features/b/load-demo-quotes";

export type QuoteComparisonData = Awaited<ReturnType<typeof loadQuoteComparison>>;

export function canAcceptQuote(data: QuoteComparisonData, quote: QuoteDTO): boolean {
  return !isFixedDemoQuote(data.demand.id) && data.demand.status === "published"
    && !data.response.data.some(row => row.status === "accepted")
    && data.response.data.includes(quote) && quote.demandId === data.demand.id
    && quote.status === "submitted" && quote.source !== undefined;
}

/** 仅由确认按钮调用；不重试写入，也不在客户端更改报价状态。 */
export async function acceptQuote(quote: QuoteDTO) {
  const input = OrderAcceptInput.parse({ demandId: quote.demandId, quoteId: quote.id, confirmed: true });
  const result = await apiPost("/api/order", input, OrderSummary);
  if (result.data.demandId !== quote.demandId || result.data.acceptedQuoteId !== quote.id
    || result.data.providerId !== quote.providerId || result.data.source !== quote.source
    || result.source !== result.data.source) {
    throw new ApiClientError("接单回执与所选报价不一致。", "INVALID_RESPONSE", 200);
  }
  return result.data;
}

export function acceptQuoteErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409 && error.code === "ORDER_ALREADY_EXISTS") return "已接受其他报价，不能改选。";
    if (error.status === 409 && error.code === "ACCEPTED_QUOTE_CONFLICT") return "存在历史已接受报价，无法建立新的接单关系，请联系平台核实。";
    if (error.status === 409) return "需求或报价状态已变化，当前不能接受。请核对重新读取的结果。";
    if (error.status === 401) return "业主登录已失效，请重新登录后刷新核实。";
    if (error.status === 403) return "当前身份无权接受这份报价，请以所属业主身份登录后刷新核实。";
    if (error.status === 404) return "需求或报价不存在，或不属于当前业主，请刷新核实。";
    if (error.status === 501) return "接受报价接口尚未开放，未确认成功。";
  }
  return "暂时无法确认本次接单结果，可能已保存。正在重新读取报价核实；不会自动重发，请勿改选。";
}

export function acceptanceReadback(data: QuoteComparisonData, quote: QuoteDTO): string {
  const accepted = data.response.data.filter(row => row.status === "accepted");
  if (accepted.length === 1 && accepted[0].id === quote.id
    && accepted[0].providerId === quote.providerId && accepted[0].source === quote.source
    && ["contracted", "in_progress", "completed"].includes(data.demand.status)) {
    return "重新读取已核实：所选报价状态为“已接受”，需求已进入接单阶段。";
  }
  if (accepted.length === 1 && accepted[0].id !== quote.id) return "重新读取显示已接受其他报价，不能改选。";
  return "重新读取尚未核实所选报价为已接受，不代表此前一定未写入。请稍后刷新核实，不要改选或重复提交。";
}
