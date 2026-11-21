import * as React from "react";
import Link from "next/link";
import { ProviderCard } from "@/components/ProviderCard";
import { Badge, C, Explainer, LinkButton, PageHeader } from "@/components/ui";
import { formatQuoteMoney } from "@/features/b/format-quote";
import { renovationLabels } from "@/lib/match";
import type { loadMatches } from "@/features/b/load-matches";

/** actions：页头右侧的操作（例如“刷新匹配”），可选。 */
export function MatchResults({ data, actions }: { data: Awaited<ReturnType<typeof loadMatches>>; actions?: React.ReactNode }) {
  const { demand, response, demandSource, providerSource, readAt } = data;
  const matches = response.data;
  const isMock = response.meta.source === "mock";

  return (
    <div className="space-y-7">
      <div>
        <Link className="mb-4 inline-block text-[14px]" href={`/owner/demand/${encodeURIComponent(demand.id)}`}>返回需求详情</Link>
        <PageHeader
          title="为这次改造，找到合适的施工团队"
          subtitle="同城同工种优先，按经验与评分排序。"
          aside={actions}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone={isMock || demandSource === undefined ? "accent" : "neutral"}>{demandSource === undefined && providerSource === "live" ? "需求来源未知 · 规则匹配" : isMock ? "含模拟数据 · 规则匹配" : "规则匹配"}</Badge>
          <span className={`break-words ${C.meta}`}>本次读取时间：<time dateTime={new Date(readAt).toISOString()}>{new Date(readAt).toISOString()}</time>（UTC）。排序和剩余天数仅反映此时点，停留期间不会自动更新，请点击“刷新匹配”重新读取。</span>
        </div>
      </div>

      <section className={C.card} aria-labelledby="demand-summary">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="!mb-0 text-[18px]" id="demand-summary">你的改造需求</h2>
          <span className={C.meta}>需求来源：{demandSource === "mock" ? "模拟数据" : demandSource === "live" ? "已保存的需求数据" : "未知（接口未提供逐条来源）"}</span>
        </div>
        <p className="max-w-[38em] text-ink-2">{demand.description}</p>
        <dl className="!mb-0 grid grid-cols-2 gap-5 border-t border-line pt-5 md:grid-cols-4">
          <div><dt className="text-[13px] text-ink-3">城市 / 面积</dt><dd className="num mt-1 text-[18px] font-semibold">{demand.city} {demand.areaM2}㎡</dd></div>
          <div><dt className="text-[13px] text-ink-3">改造类型</dt><dd className="mt-1 text-[18px] font-semibold">{renovationLabels[demand.renovationType]}</dd></div>
          <div><dt className="text-[13px] text-ink-3">预算范围</dt><dd className="num mt-1 break-words text-[18px] font-semibold">{formatQuoteMoney(demand.budgetMinCents)} – {formatQuoteMoney(demand.budgetMaxCents)}</dd></div>
          <div><dt className="text-[13px] text-ink-3">期望工期</dt><dd className="num mt-1 text-[18px] font-semibold">{demand.desiredDays} 天</dd></div>
        </dl>
      </section>

      <section aria-labelledby="matches-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="!mb-0" id="matches-heading">{matches.length ? `${matches.length} 家符合城市与工种的候选团队` : providerSource === "mock" ? "当前模拟资料中暂未找到符合条件的团队" : "本次返回的资料中暂未找到符合条件的团队"}</h2>
          {matches.length > 0 && <span className={C.meta}>按匹配分从高到低排列</span>}
        </div>
        <p className={`${C.meta} !mb-1`}>服务方来源：{providerSource === "mock" ? "模拟资料和样例评分" : "服务方接口数据"}</p>
        <p className={`${C.meta} !mb-4`}>基础资料与评价统计来源逐团队分别标注。{data.performanceSource === "mock" ? "当前显式查询 mock 模拟接单评价，仅供演示，不代表真实口碑。" : "当前默认查询 live 评价，不用 mock 评价补齐无样本结果。"}</p>
        {matches.length ? (
          <div className="grid gap-5 md:grid-cols-2">{matches.map((match, index) => <ProviderCard key={match.provider.id} match={match} rank={index + 1} desiredDays={demand.desiredDays} readAt={readAt} />)}</div>
        ) : (
          <div className="rounded-card border border-dashed border-line-strong bg-white p-8 text-center" role="status">
            <p className="mx-auto max-w-[38em]">{providerSource === "mock"
              ? "当前服务方接口仅提供模拟资料，其中没有符合这份需求城市与工种的团队，不能据此判断是否存在真实可接单团队。"
              : "本次返回的服务方资料中，没有符合这份需求城市与工种的团队；这不代表当地没有施工团队。"}</p>
            <p className="text-[15px] text-ink-2">可以返回需求详情核对城市，或使用页面上方的“刷新匹配”重新读取资料。</p>
            <Link className="text-[15px] font-medium" href={`/owner/demand/${encodeURIComponent(demand.id)}`}>查看需求详情</Link>
          </div>
        )}
      </section>

      <Explainer summary="排序说明">
        <p id="matching-notes" className="font-semibold text-ink">做决定前，还需要确认</p>
        <p>同城同工种优先，按经验与评分排序。基础分相同时，符合条件的整组依次参考已完成接单评价均分、档期窗口。</p>
        <p>匹配分 = 改造标签匹配 60 分 + 服务方评分 × 8（四舍五入，最高 40 分）。这是基础分，评价和档期不加分，也不改变不同基础分组的顺序。同分组全部有有效且同来源的评价时，按均分降序；否则跳过评价，不按样本数量加分。</p>
        <p>同基础分组的档期全部在读取时有效且来源一致时，前序规则仍同序的候选中，单段剩余窗口可容纳期望天数者优先，否则跳过档期；最终按编号稳定展示。窗口按上海自然日含首尾计天，从今天截断，不累计或拼接多段。未知与过期不淘汰候选。</p>
        <p>null 表示没有均分，不当作 0 分；缺少评价不淘汰候选。少于 3 条显示“样本少”，请谨慎参考。评价反映业主反馈，不代表施工质量保证。</p>
        <p>服务方的报价、可接单日期和资质尚未核验。预算与期望工期只是你的需求，当前不作为已满足条件。</p>
        {providerSource === "mock" && <p>目录整体含模拟资料；基础资料评分与已完成接单评价是不同指标，评价统计来源见每张卡片。</p>}
        <p>匹配分由规则计算，未调用 AI 模型。</p>
      </Explainer>

      <section className={`${C.card} flex flex-wrap items-center justify-between gap-4`} aria-labelledby="match-next-step">
        <div>
          <h2 className="!mb-1 text-[18px]" id="match-next-step">下一步：看清完整报价</h2>
          <p className="!mb-0 text-[15px] text-ink-2">逐项确认服务范围和未定费用，再决定与谁合作。</p>
        </div>
        <LinkButton href={`/owner/quotes/${encodeURIComponent(demand.id)}`}>查看该需求报价</LinkButton>
      </section>
    </div>
  );
}
