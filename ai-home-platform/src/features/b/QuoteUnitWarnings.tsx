import * as React from "react";
import type { DemandDTO, QuoteDTO } from "@/contracts";
import { findQuoteUnitDifferences } from "@/lib/quote-engine/unit-differences";

const units: Record<QuoteDTO["items"][number]["unit"], string> = { m2: "平方米（㎡）", piece: "件", job: "项" };

export function QuoteUnitWarnings({ demandId, quotes }: { demandId: DemandDTO["id"]; quotes: QuoteDTO[] }) {
  const differences = findQuoteUnitDifferences(demandId, quotes);
  if (!differences.length) return null;

  return <aside className="mb-5 rounded-control border border-warn/30 bg-warn-soft p-5 text-warn" aria-label="同名项目计价单位提醒">
    <h3 className="mb-2 text-[17px] font-semibold">同名项目计价单位不一致 · {differences.length} 项</h3>
    <p className="text-[15px]">以下不同报价中的同名项目使用了不同单位，不能直接比较单价。请先核对数量、材料和施工范围。</p>
    <ul className="space-y-4">
      {differences.map(({ name, rows }) => <li className="break-words" key={name}>
        <p className="mb-2 font-semibold">{name}</p>
        <ul className="list-inside list-disc space-y-1 text-[14px]">
          {rows.map(({ quoteId, itemIndex, item }) => <li key={`${quoteId}:${itemIndex}`}>
            报价 <span className="break-all">{quoteId}</span>，第 {itemIndex + 1} 行（项目编号：<span className="break-all">{item.code}</span>）：{item.quantity} {units[item.unit]}
          </li>)}
        </ul>
      </li>)}
    </ul>
    <p className="mb-0 mt-4 text-[13px]">仅按去除首尾空白后的项目名称提示，不代表施工范围相同；未出现提醒也不代表报价可直接比较。本提示不换算单位、不调整金额、不判断哪份报价更便宜。数据来源见下方逐份报价标识。</p>
  </aside>;
}
