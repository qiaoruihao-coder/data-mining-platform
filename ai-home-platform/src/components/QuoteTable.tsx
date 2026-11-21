import * as React from "react";
import type { DemandDTO, ProviderDTO, QuoteDTO } from "@/contracts";
import { Badge, C, SealStamp } from "@/components/ui";
import { formatQuoteMoney } from "@/features/b/format-quote";
import { QuoteBudgetSummary } from "@/features/b/QuoteBudgetSummary";
import { QuoteDurationSummary } from "@/features/b/QuoteDurationSummary";
import { getPendingQuoteItems, summarizeQuote } from "@/lib/quote-engine";

const units: Record<QuoteDTO["items"][number]["unit"], string> = { m2: "㎡", piece: "件", job: "项" };
const statuses: Record<QuoteDTO["status"], string> = {
  draft: "草稿", submitted: "已提交", accepted: "已接受", rejected: "已拒绝",
};

export function QuoteTable({ quotes, providers = [], demand }: { quotes: QuoteDTO[]; providers?: ProviderDTO[]; demand?: DemandDTO }) {
  if (!quotes.length) {
    return <div className="rounded-card border border-dashed border-line-strong bg-white p-8 text-center"><h2>暂无可对比的报价</h2><p className="mb-0 text-ink-2">这份需求还没有已提交或已接受的报价，请等待服务方补充。</p></div>;
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      {quotes.map((quote) => {
        const summary = summarizeQuote(quote);
        const pending = getPendingQuoteItems(quote);
        const providerName = providers.find((provider) => provider.id === quote.providerId)?.name ?? `服务方 ${quote.providerId}（名称待确认）`;
        const accepted = quote.status === "accepted";
        return (
          <article className={`min-w-0 overflow-hidden ${C.cardFlush} ${accepted ? "border-brand/40" : ""}`} key={quote.id}>
            <header className="border-b border-line p-5">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="mb-1 text-[18px] font-semibold">{providerName}</h3>
                  <span className={`${C.meta} break-all`}>报价编号：{quote.id}</span>
                </div>
                {accepted
                  ? <span className="-mr-1 -mt-1 shrink-0"><SealStamp label="已接受" className="!h-14 !w-14 !text-[14px]" /><span className="sr-only">{statuses[quote.status]}</span></span>
                  : <Badge tone="neutral">{statuses[quote.status]}</Badge>}
              </div>
              <p className={`!mb-0 mt-2 ${C.meta}`}>本份报价来源：{quote.source === "mock"
                ? "mock · 模拟报价，不代表真实市场报价"
                : quote.source === "live" ? "live · 非模拟报价数据" : "来源未知，请核实"}</p>
              <p className="!mb-0 mt-2 text-[15px] text-ink-2">预计施工 <span className="num font-semibold text-ink">{quote.estimatedDays}</span> 天，档期待确认</p>
            </header>

            <div className="overflow-x-auto" role="region" aria-label={`${providerName}报价明细`} tabIndex={0}>
              <table className="w-full min-w-[360px] text-left text-sm">
                <caption className="sr-only">{providerName}的逐项报价，金额单位为人民币元</caption>
                <thead className="bg-canvas text-[13px] text-ink-2"><tr>
                  <th className="px-4 py-3 font-medium" scope="col">项目 / 范围说明</th>
                  <th className="whitespace-nowrap px-2 py-3 text-right font-medium" scope="col">数量</th>
                  <th className="whitespace-nowrap px-2 py-3 text-right font-medium" scope="col">单价</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium" scope="col">列明金额</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {quote.items.map((item, index) => <tr className={item.amountCents === null ? "bg-warn-soft" : undefined} key={`${item.code}-${index}`}>
                    <th className="break-words px-4 py-4 align-top font-normal" scope="row"><span className="font-medium text-ink">{item.name}</span><span className="mt-1 block break-all text-[13px] text-ink-3">项目编号：{item.code}</span><span className="mt-1 block text-[13px] leading-5 text-ink-3">{item.note || "服务范围待确认"}</span></th>
                    <td className="num whitespace-nowrap px-2 py-4 text-right align-top">{item.quantity} {units[item.unit]}</td>
                    <td className="num whitespace-nowrap px-2 py-4 text-right align-top tabular-nums">{formatQuoteMoney(item.unitPriceCents)}</td>
                    <td className={`num whitespace-nowrap px-4 py-4 text-right align-top tabular-nums ${item.amountCents === null ? "font-semibold text-warn" : "font-medium text-ink"}`}>{formatQuoteMoney(item.amountCents)}</td>
                  </tr>)}
                  {!quote.items.length && <tr><td className="px-4 py-6 text-ink-2" colSpan={4}>暂无报价明细，费用待确认。</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="space-y-4 border-t border-line p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold">已知费用小计</span>
                <strong className="num text-[26px] leading-none tabular-nums text-brand-hover">{formatQuoteMoney(summary.knownTotalCents)}</strong>
              </div>
              {demand && <QuoteBudgetSummary demand={demand} quote={quote} />}
              {demand && <QuoteDurationSummary demand={demand} quote={quote} />}
              {summary.pendingItems.length ? <div className="rounded-control border border-warn/25 bg-warn-soft p-4 text-warn">
                <h4 className="text-[15px] font-semibold">待确认项目 · {summary.pendingItems.length} 项</h4>
                <ul className="mt-2 list-inside list-disc break-words text-[14px] leading-6">
                  {pending.extraNames.map((name) => <li key={`extra:${name}`}>{name}</li>)}
                  {pending.items.map((item, index) => <li key={`item:${item.code}:${index}`}>{item.name}<span className="break-all">（项目编号：{item.code}）</span></li>)}
                </ul>
                <p className="mb-0 mt-2 text-[13px]">未知金额未计入小计；已列明金额的项目仍可能需要确认单价。小计不是最终总价。</p>
              </div> : <p className="mb-0 text-[15px] text-ink-2">{quote.items.length ? "费用已列明，服务范围需双方确认。" : "暂无明细，总价待确认。"}</p>}
            </div>
          </article>
        );
      })}
    </div>
  );
}
