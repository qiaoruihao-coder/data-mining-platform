import type { DemandDTO, QuoteDTO } from "@/contracts";

/** 只比较报价中提及的名称，不推断需求必需项、套餐包含范围或漏报责任。 */
export function findQuoteItemGaps(demandId: DemandDTO["id"], quotes: QuoteDTO[]) {
  const eligible = quotes.filter(quote => quote.demandId === demandId && ["submitted", "accepted"].includes(quote.status));
  if (new Set(eligible.map(quote => quote.id)).size < 2) return [];

  const mentions = eligible.map(quote => {
    const names = new Map<string, number[]>();
    quote.items.forEach((item, index) => {
      const name = item.name.trim();
      if (!name) return;
      const indexes = names.get(name) ?? [];
      indexes.push(index);
      names.set(name, indexes);
    });
    // 仅在待确认名称数组中出现也算已提及，不能误报为完全缺项。
    for (const value of quote.pendingItems) {
      const name = value.trim();
      if (name && !names.has(name)) names.set(name, []);
    }
    return { quoteId: quote.id, names };
  });
  const allNames = new Set(mentions.flatMap(quote => [...quote.names.keys()]));
  return [...allNames].flatMap(name => {
    const unmentionedQuoteIds = mentions.filter(quote => !quote.names.has(name)).map(quote => quote.quoteId);
    if (!unmentionedQuoteIds.length) return [];
    return [{
      name,
      mentionedIn: mentions.filter(quote => quote.names.has(name)).map(quote => ({
        quoteId: quote.quoteId, itemIndexes: quote.names.get(name)!,
      })),
      unmentionedQuoteIds,
    }];
  });
}
