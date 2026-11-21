"use client";

import * as React from "react";
import type { OrderSummaryDTO, QuoteDTO } from "@/contracts";
import { Button, C, Card } from "@/components/ui";
import { acceptQuote, acceptQuoteErrorMessage, acceptanceReadback, canAcceptQuote, type QuoteComparisonData } from "@/features/b/accept-quote";
import { formatQuoteMoney } from "@/features/b/format-quote";
import { summarizeQuote } from "@/lib/quote-engine";
import { QuoteOrderVerification } from "@/features/b/QuoteOrderVerification";

type Attempt = { quote: QuoteDTO; original: QuoteComparisonData; order?: OrderSummaryDTO; message?: string };

export function QuoteAcceptance({ data, onBusy, refresh }: {
  data: QuoteComparisonData | null;
  onBusy: (busy: boolean) => void;
  refresh: () => void;
}) {
  const [selection, setSelection] = React.useState<{ quote: QuoteDTO; data: QuoteComparisonData } | null>(null);
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [busy, setBusy] = React.useState(false);
  // 同一页面只发一次。同步锁覆盖双击；刷新、失焦和核实均不能触发 POST。
  const submitted = React.useRef(false);
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selected = selection?.data === data && data && canAcceptQuote(data, selection.quote) ? selection.quote : null;

  async function confirm() {
    if (!selected || !data || submitted.current) return;
    submitted.current = true;
    const current: Attempt = { quote: selected, original: data };
    setAttempt(current);
    setBusy(true);
    onBusy(true);
    try {
      const order = await acceptQuote(selected);
      if (mounted.current) setAttempt({ ...current, order });
    } catch (error) {
      if (mounted.current) setAttempt({ ...current, message: acceptQuoteErrorMessage(error) });
    } finally {
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
        refresh();
      }
    }
  }

  if (attempt) return <Card>
    <h2>接受报价的结果核实</h2>
    <div role="status" aria-live="polite" className="break-words text-[15px] text-ink-2">
      <p className="break-all">本次所选报价：{attempt.quote.id}；来源：{attempt.quote.source}</p>
      {busy ? <p>正在提交确认，请勿重复操作…</p> : <>
        {attempt.order && <p>本次提交已收到成功回执（来源：{attempt.order.source}）；最新接单关系以下方只读核实为准。</p>}
        {attempt.message && <p>{attempt.message}</p>}
        <p>{data && data !== attempt.original ? acceptanceReadback(data, attempt.quote) : "报价状态尚待重新读取核实，请等待加载；读取失败可点击重新加载。"}</p>
        <QuoteOrderVerification data={data !== attempt.original ? data : null} selectedQuote={attempt.quote} />
        <p className="mb-0">本页不会再次发送接受请求。可使用“刷新报价”继续只读核实；不支持改选或取消。</p>
      </>}
    </div>
  </Card>;

  if (!data) return null;
  const eligible = data.response.data.filter(quote => canAcceptQuote(data, quote));
  if (!eligible.length) return <Card><p className="mb-0 text-[15px] text-ink-2">当前没有可接受的报价。仅已发布需求的已提交报价可选择；已接受、历史冲突及来源未知的报价不能在此改选。</p></Card>;
  const summary = selected ? summarizeQuote(selected) : null;
  return <Card>
    <h2>接受一份报价</h2>
    <p className="max-w-[38em] text-[15px] text-ink-2">请先核对上方明细，再选择一份报价查看确认说明。每份需求只能接受一份报价，接受后不支持改选或取消。</p>
    <div className="flex flex-wrap gap-3">
      {eligible.map(quote => <Button key={quote.id} variant="secondary" aria-pressed={selected?.id === quote.id}
        className="max-w-full whitespace-normal break-all text-left" onClick={() => setSelection({ quote, data })}>
        选择报价 {quote.id}（{data.providers.find(provider => provider.id === quote.providerId)?.name ?? quote.providerId}）
      </Button>)}
    </div>
    {selected && summary && <section className="mt-5 rounded-control border border-warn/30 bg-warn-soft p-5 text-ink" aria-label="接受报价确认">
      <h3 className="mb-3">请确认所选报价</h3>
      <p className={`break-all ${C.meta}`}>需求：{selected.demandId}；报价：{selected.id}；服务方：{selected.providerId}</p>
      <p className={C.meta}>报价来源：{selected.source === "mock" ? "mock · 模拟报价，不代表真实市场报价" : "live · 非模拟报价数据"}；需求来源：{data.demandSource ?? "未知"}；报价查询整体来源：{data.quoteSource}</p>
      <p className="num text-[15px]">已知费用小计：<strong>{formatQuoteMoney(summary.knownTotalCents)}</strong>，不是最终总价；预计 {selected.estimatedDays} 天，档期待确认。</p>
      {summary.pendingItems.length > 0 ? <div className="text-[15px] text-warn"><p>待确认费用／项目（未知金额未计入小计）：</p><ul className="list-inside list-disc break-words">{summary.pendingItems.map((name, index) => <li key={index}>{name}</li>)}</ul></div>
        : <p className="text-[15px]">当前没有列出的待定费用，不代表服务范围完整或最终总价已确定。</p>}
      <p className="mt-4 text-[15px] font-semibold text-warn">确认仅建立平台接单关系，不代表最终价格已确定、已付款、已签署法律合同、已开工或已完成施工验收。请先与服务方确认范围和待定费用。</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => void confirm()}>确认接受此报价</Button>
        <Button variant="secondary" onClick={() => setSelection(null)}>取消本次确认</Button>
      </div>
    </section>}
  </Card>;
}
