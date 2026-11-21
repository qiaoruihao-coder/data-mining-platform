import React from "react";
import type { QuoteDTO, SourceDTO } from "@/contracts";
import { formatQuoteMoney, quoteUnitLabels } from "./quote-form";
import { QuoteSource } from "./QuoteSource";

export function QuoteReceipt({ quote, source }: { quote: QuoteDTO; source: SourceDTO }) {
  const unknownItems = quote.items.filter((item) => item.unitPriceCents === null || item.amountCents === null);
  const hasPending = unknownItems.length > 0 || quote.pendingItems.length > 0;

  return (
    <section role="status" className="num mt-4 rounded-card border border-brand/20 bg-brand-soft p-4 sm:p-6">
      <h3 className="!mb-1">{source === "mock" ? "模拟报价已提交" : "报价已提交"}</h3>
      <p>{source === "mock" ? "模拟报价已保存。" : "报价已保存，等待业主确认。"}</p>
      <QuoteSource source={quote.source} />
      <p className="break-all">报价编号：{quote.id}</p>
      <p className="break-all">关联需求：{quote.demandId}</p>
      <p className="break-all">服务方编号：{quote.providerId}</p>
      <p>预计工期：{quote.estimatedDays} 天</p>

      <h4 className="mb-1 mt-6 text-[16px] font-semibold">服务端返回的报价明细</h4>
      <p className="text-[13px] text-ink-3">以下数量、单价、项目金额和备注来自本次接口回执，供核对已提交内容。</p>
      {quote.items.length === 0 ? (
        <p>报价明细缺失，请联系平台核实。</p>
      ) : (
        <ol aria-label="已提交报价明细" className="space-y-3">
          {quote.items.map((item, index) => (
            <li key={`${index}-${item.code}`} className="min-w-0 break-words rounded-control border border-line bg-white p-4 [overflow-wrap:anywhere]">
              <h5 className="!mb-0 text-[16px] font-semibold">{index + 1}. {item.name}</h5>
              <p className="mb-1 mt-2 text-sm">项目编号：{item.code}</p>
              <p className="mb-1 text-sm">
                数量：{item.quantity} {quoteUnitLabels[item.unit]}；单价：{item.unitPriceCents === null ? "待确认" : `${formatQuoteMoney(item.unitPriceCents)}/${quoteUnitLabels[item.unit]}`}
              </p>
              <p className="mb-1 font-medium">项目金额：{item.amountCents === null ? "待确认，未计入小计" : formatQuoteMoney(item.amountCents)}</p>
              {item.note && <p className="mb-0 whitespace-pre-wrap text-sm text-ink-2">备注：{item.note}</p>}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 break-words text-[18px] font-semibold text-brand-hover">已知费用小计：{formatQuoteMoney(quote.knownTotalCents)}</p>
      {hasPending && (
        <div className="text-sm">
          <p>含待确认费用，总价未定。</p>
          {quote.pendingItems.length > 0 && (
            <>
              <p>待确认事项：</p>
              <ul aria-label="回执待确认事项" className="list-inside list-disc space-y-1">
                {quote.pendingItems.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
      <p className="!mb-0">业主可在报价对比页查看，是否接单以业主确认为准。请勿重复提交。</p>
    </section>
  );
}
