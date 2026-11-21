import React from "react";
import type { QuoteDTO } from "@/contracts";
import { formatQuoteMoney, quoteUnitLabels } from "./quote-form";

export function ProviderQuoteDetails({ quote }: { quote: QuoteDTO }) {
  const hasPending = quote.pendingItems.length > 0 || quote.items.some((item) => item.unitPriceCents === null || item.amountCents === null);

  return (
    <details className="mt-4 min-w-0 rounded-control border border-line bg-white">
      <summary className="num cursor-pointer rounded-control px-4 py-3 text-[15px] font-medium">
        报价明细（{quote.items.length} 项）
        <span className="sr-only">，报价编号：{quote.id}</span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        <p className="!mb-0 text-[13px] text-ink-3">以下为本次查询返回的已保存明细，供逐项核对；金额以记录为准。</p>
        {quote.items.length === 0 ? (
          <p className="!mb-0 text-sm">接口未提供报价明细，无法逐项核对；不能据此认定费用为零或已全部确认。</p>
        ) : (
          <ol aria-label={`报价 ${quote.id} 的项目明细`} className="space-y-3">
            {quote.items.map((item, index) => (
              <li key={`${index}-${item.code}`} className="min-w-0 rounded-control bg-canvas p-4 [overflow-wrap:anywhere]">
                <h3 className="!mb-0 text-[16px] font-semibold">{index + 1}. {item.name || "未提供项目名称"}</h3>
                <p className="mb-2 mt-1 text-[13px] text-ink-3">项目编号：{item.code}</p>
                <dl className="num m-0 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[13px] text-ink-3">数量</dt>
                    <dd className="m-0 mt-1">{item.quantity} {quoteUnitLabels[item.unit]}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-ink-3">单价</dt>
                    <dd className="m-0 mt-1">{item.unitPriceCents === null ? "待确认" : `${formatQuoteMoney(item.unitPriceCents)}/${quoteUnitLabels[item.unit]}`}</dd>
                  </div>
                  <div>
                    <dt className="text-[13px] text-ink-3">项目金额</dt>
                    <dd className="m-0 mt-1 font-medium">{item.amountCents === null ? "待确认" : formatQuoteMoney(item.amountCents)}</dd>
                  </div>
                </dl>
                {item.note && <p className="mt-3 !mb-0 whitespace-pre-wrap text-sm text-ink-2">备注：{item.note}</p>}
              </li>
            ))}
          </ol>
        )}
        {hasPending && <p className="!mb-0 text-sm">含待确认费用，完整总价未确定；未知费用不按零计算。</p>}
        {quote.pendingItems.length > 0 && (
          <div className="text-sm">
            <h3 className="mb-2 text-[15px] font-semibold">记录中的待确认事项</h3>
            <ul aria-label={`报价 ${quote.id} 的待确认事项`} className="list-inside list-disc space-y-1">
              {quote.pendingItems.map((item, index) => (
                <li key={index} className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item || "未提供事项说明"}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
