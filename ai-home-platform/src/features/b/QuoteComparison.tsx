import * as React from "react";
import Link from "next/link";
import { Badge, C, Explainer, PageHeader } from "@/components/ui";
import { QuoteTable } from "@/components/QuoteTable";
import { QuoteUnitWarnings } from "@/features/b/QuoteUnitWarnings";
import { formatQuoteMoney } from "@/features/b/format-quote";
import { QuoteItemGapWarnings } from "@/features/b/QuoteItemGapWarnings";
import type { loadQuoteComparison } from "@/features/b/load-quotes";

/** intro：放在页头下方的页面级内容（演示说明、读取状态与刷新），可选。 */
export function QuoteComparison({ data, intro }: { data: Awaited<ReturnType<typeof loadQuoteComparison>>; intro?: React.ReactNode }) {
  const { demand, providers, response, demandSource, quoteSource, providerSource, providerWarning } = data;
  const id = encodeURIComponent(demand.id);
  return (
    <div className="space-y-7">
      <div>
        <Link className="mb-4 inline-block text-[14px]" href={`/owner/matches/${id}`}>返回服务方匹配</Link>
        <PageHeader
          title="先看清每一项，再比较报价"
          subtitle="已知费用从列明金额逐项汇总，待确认项目单独保留。套餐名称相同，也需要核对实际施工范围。"
        />
        {intro && <div className="space-y-4">{intro}</div>}
      </div>

      <section className={C.card} aria-labelledby="quote-demand">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="!mb-0 text-[18px]" id="quote-demand">这次改造的需求</h2>
          <span className={C.meta}>需求来源：{demandSource === "mock" ? "模拟数据" : demandSource === "live" ? "已保存的需求数据" : "未知（接口未提供逐条来源）"}</span>
        </div>
        <p className="max-w-[38em] text-ink-2">{demand.description}</p>
        <dl className="!mb-0 grid gap-5 border-t border-line pt-5 sm:grid-cols-3">
          <div><dt className="text-[13px] text-ink-3">城市 / 面积</dt><dd className="num mt-1 text-[18px] font-semibold">{demand.city} {demand.areaM2}㎡</dd></div>
          <div><dt className="text-[13px] text-ink-3">预算范围</dt><dd className="num mt-1 text-[18px] font-semibold">{formatQuoteMoney(demand.budgetMinCents)} – {formatQuoteMoney(demand.budgetMaxCents)}</dd></div>
          <div><dt className="text-[13px] text-ink-3">期望工期</dt><dd className="num mt-1 text-[18px] font-semibold">{demand.desiredDays} 天</dd></div>
        </dl>
      </section>

      <section aria-labelledby="quote-list">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="!mb-0 flex items-center gap-2" id="quote-list">报价明细对比 <Badge tone="neutral"><span className="num">{response.data.length}</span> 份</Badge></h2>
          <span className={C.meta}>展示顺序不代表价格或质量排名</span>
        </div>
        <p className={`${C.meta} !mb-4`}>报价查询整体来源：{quoteSource === "mock" ? "mock（需求或报价含模拟／未知来源）" : "live"}；每份报价来源见下方标注。{providerSource !== null && <> 服务方来源：{providerSource === "mock" ? "模拟资料" : "服务方接口数据"}</>}</p>
        {providerWarning && <div className="mb-4 rounded-control border border-warn/25 bg-warn-soft p-4 text-[15px] text-warn" role="alert">
          <p>{providerWarning}</p>
          <p className="mb-0">服务方资料未取得，来源未知；以下按报价中的服务方编号展示。</p>
        </div>}
        <div role="group" aria-label="报价核对提醒" className="empty:hidden">
          <QuoteItemGapWarnings demandId={demand.id} quotes={response.data} />
          <QuoteUnitWarnings demandId={demand.id} quotes={response.data} />
        </div>
        <QuoteTable quotes={response.data} providers={providers} demand={demand} />
      </section>

      <Explainer summary="比较前须知：已知小计不是最终总价">
        <p id="quote-notes" className="font-semibold text-ink">确认范围后，才能比较最终费用</p>
        <p>逐项核对数量、单位、材料、施工范围与增项约定。已知小计更低，不代表最终总价更低；明细全部定价，也不代表覆盖了完整需求。</p>
        <p>预计天数是报价中的工期估计，不代表服务方档期已确认。查看报价不会自动接受；明确确认接受也不代表最终总价已确定或完成付款。</p>
      </Explainer>
      <Link className="inline-block text-[15px] font-medium" href={`/owner/demand/${id}`}>查看原始需求</Link>
    </div>
  );
}
