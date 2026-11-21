import { Money, Quote, type DemandDTO, type QuoteDTO } from "@/contracts";

/** 按原始明细行保留待确认项；历史输出允许重复编号，不能按 code 覆盖费用。 */
export function getPendingQuoteItems(quote: QuoteDTO) {
  const items = quote.items.filter((item) => item.amountCents === null || item.unitPriceCents === null);
  const itemNames = new Set(items.map((item) => item.name));
  // prepareQuotes 会将明细名称写回 pendingItems；再次汇总时不能重复计数。
  const extraNames = [...new Set(quote.pendingItems)].filter((name) => !itemNames.has(name));
  return { items, extraNames };
}

/** 只汇总明细中已列明的金额；未知项和额外待确认费用必须保留。 */
export function summarizeQuote(quote: QuoteDTO): Pick<QuoteDTO, "knownTotalCents" | "pendingItems"> {
  let knownTotalCents = 0;

  for (const item of quote.items) {
    if (item.amountCents !== null) {
      // 单项和累计值都必须是安全整数，避免溢出后展示错误金额。
      knownTotalCents = Money.parse(knownTotalCents + Money.parse(item.amountCents));
    }
  }
  const { items, extraNames } = getPendingQuoteItems(quote);
  // 公共契约仍为名称数组；每一条待确认明细都保留名称，包括同名或同编号行。
  return { knownTotalCents, pendingItems: [...extraNames, ...items.map((item) => item.name)] };
}

/** 业主当前对比只包含同一需求已提交或已接受的报价，不信任缓存合计。 */
export function prepareQuotes(demandId: DemandDTO["id"], candidates: QuoteDTO[]): QuoteDTO[] {
  return candidates
    .filter((quote) => quote.demandId === demandId && (quote.status === "submitted" || quote.status === "accepted"))
    .map((quote) => Quote.parse({ ...quote, ...summarizeQuote(quote) }));
}
