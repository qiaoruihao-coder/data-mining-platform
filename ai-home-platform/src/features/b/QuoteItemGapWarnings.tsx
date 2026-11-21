import * as React from "react";
import type { DemandDTO, QuoteDTO } from "@/contracts";
import { findQuoteItemGaps } from "@/lib/quote-engine/item-gaps";

export function QuoteItemGapWarnings({ demandId, quotes }: { demandId: DemandDTO["id"]; quotes: QuoteDTO[] }) {
  const gaps = findQuoteItemGaps(demandId, quotes);
  if (!gaps.length) return null;

  return <aside className="mb-5 rounded-control border border-warn/30 bg-warn-soft p-5 text-warn" aria-label="报价列项差异提醒">
    <h3 className="mb-2 text-[17px] font-semibold">报价列项差异 · {gaps.length} 项待核对</h3>
    <p className="text-[15px]">有的报价提及以下项目，有的尚未提及。请确认是否包含在套餐、使用其他名称，或仍需补充说明。</p>
    <ul className="space-y-4">
      {gaps.map(({ name, mentionedIn, unmentionedQuoteIds }) => <li className="break-words" key={name}>
        <p className="mb-2 font-semibold">{name}</p>
        <ul className="list-inside list-disc space-y-1 text-[14px]">
          {mentionedIn.map(({ quoteId, itemIndexes }) => <li key={`mentioned:${quoteId}`}>
            已提及：报价 <span className="break-all">{quoteId}</span>，{itemIndexes.length
              ? `明细第 ${itemIndexes.map(index => index + 1).join("、")} 行`
              : "仅列于待确认项目，尚无同名明细"}
          </li>)}
          {unmentionedQuoteIds.map(quoteId => <li key={`unmentioned:${quoteId}`}>
            未提及：报价 <span className="break-all">{quoteId}</span>（明细及待确认列表均无同名项目）
          </li>)}
        </ul>
      </li>)}
    </ul>
    <p className="mb-0 mt-4 text-[13px]">仅按去除首尾空白后的名称核对；同名不代表同一范围，未提及不代表漏报或免费，未出现提醒也不代表覆盖完整需求。不补零、不调整合计、不据此判断总价高低。数据来源见下方逐份报价标识。</p>
  </aside>;
}
