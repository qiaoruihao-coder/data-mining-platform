import type { OrderSummaryDTO } from "@/contracts";
import { ApiClientError } from "@/lib/api-client";
import { loadProviderOrders, providerOrdersErrorMessage } from "./provider-orders";

export async function loadProviderOrderQuote(order: OrderSummaryDTO) {
  // 复用服务端按当前会话限定的本人报价列表，不使用业主比较接口或自报身份。
  const response = await loadProviderOrders();
  const quote = response.data.find(item => item.id === order.acceptedQuoteId);
  if (!quote) {
    throw new ApiClientError("未找到接单关联报价。", "ORDER_QUOTE_NOT_FOUND", 200);
  }
  if (quote.demandId !== order.demandId || quote.providerId !== order.providerId
    || quote.status !== "accepted" || (quote.source !== undefined && quote.source !== order.source)) {
    throw new ApiClientError("接单与报价关联不一致。", "ORDER_QUOTE_MISMATCH", 200);
  }
  return { quote, source: response.meta.source };
}

export type ProviderOrderQuoteState =
  | { status: "loading" }
  | { status: "ready"; response: Awaited<ReturnType<typeof loadProviderOrderQuote>> }
  | { status: "error"; message: string };

export function providerOrderQuoteErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === "ORDER_QUOTE_NOT_FOUND") return "本次本人报价中未找到该接单的已接受报价。请刷新接单后重试，暂时无法核对费用明细。";
    if (error.code === "ORDER_QUOTE_MISMATCH") return "接单与报价的需求、服务方、状态或来源不一致。请刷新接单后重试，暂时无法核对费用明细。";
  }
  return providerOrdersErrorMessage(error);
}
