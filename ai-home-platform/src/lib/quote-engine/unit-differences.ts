import type { DemandDTO, QuoteDTO } from "@/contracts";

/** 名称仅用于提示核对，不把同名或同编号明细认定为相同施工范围。 */
export function findQuoteUnitDifferences(demandId: DemandDTO["id"], quotes: QuoteDTO[]) {
  const groups = new Map<string, { quoteId: QuoteDTO["id"]; itemIndex: number; item: QuoteDTO["items"][number] }[]>();
  for (const quote of quotes) {
    if (quote.demandId !== demandId || !["submitted", "accepted"].includes(quote.status)) continue;
    quote.items.forEach((item, itemIndex) => {
      const name = item.name.trim();
      if (!name) return;
      const rows = groups.get(name) ?? [];
      rows.push({ quoteId: quote.id, itemIndex, item });
      groups.set(name, rows);
    });
  }

  return [...groups].flatMap(([name, rows]) => {
    // 至少两份报价才构成跨报价提醒；重复编号和同名行仍逐行保留。
    if (new Set(rows.map(row => row.quoteId)).size < 2 || new Set(rows.map(row => row.item.unit)).size < 2) return [];
    return [{ name, rows }];
  });
}
