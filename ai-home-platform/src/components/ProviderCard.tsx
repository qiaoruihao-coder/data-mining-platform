import * as React from "react";
import type { z } from "zod";
import type { Match } from "@/contracts";
import { C } from "@/components/ui";
import { AvailabilitySummary } from "@/features/b/AvailabilitySummary";

export function ProviderCard({ match, rank, desiredDays, readAt }: { match: z.infer<typeof Match>; rank: number; desiredDays?: number; readAt?: number }) {
  const { provider, score, reasons } = match;
  return (
    <article className={C.card}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="num text-[13px] font-medium text-ink-3">第 {rank} 名</span>
          <h3 className="mb-1 mt-1 text-[18px] font-semibold">{provider.name}</h3>
          <p className="num !mb-1 text-[15px] text-ink-2">{provider.city}施工团队，基础资料评分 {provider.rating}/5</p>
          <p className="text-[13px] text-ink-3">基础资料来源：{provider.source === "mock" ? "mock · 模拟资料" : provider.source === "live" ? "live" : "未知"}；此评分不是已完成接单评价均分。</p>
        </div>
        <div className="shrink-0 rounded-control bg-brand-soft px-4 py-3 text-center" aria-label={`匹配分 ${score}，满分 100`}>
          <strong className="num block text-[30px] leading-none text-brand-hover">{score}</strong>
          <div className="mt-1.5 text-[13px] text-brand">匹配分 / 100</div>
        </div>
      </div>
      <section className="mb-4 mt-4 rounded-control bg-canvas p-4 text-[14px] text-ink-2" aria-label="已完成接单评价">
        <h4 className="mb-2 text-[14px] font-semibold text-ink">已完成接单的业主评价</h4>
        {provider.performance ? <>
          <p>{provider.performance.averageRating === null ? "暂无评价" : `评价均分 ${provider.performance.averageRating.toFixed(2)}/5`}</p>
          <p className="num">样本数：{provider.performance.reviewCount} 条{provider.performance.reviewCount < 3 && <span className={`ml-2 ${C.badge} ${C.badgeAccent}`}>样本少</span>}</p>
          <p>评价来源：{provider.performance.source === "mock" ? "模拟评价" : "业主评价"}</p>
          <p className="break-all text-[13px]">服务端计算时间：<time dateTime={provider.performance.calculatedAt}>{provider.performance.calculatedAt}</time></p>
        </> : <p>暂无评价汇总</p>}
        <p className="mb-0 text-[13px] text-ink-3">评价仅供参考，不作为质量认证。</p>
      </section>
      {desiredDays !== undefined && readAt !== undefined && <AvailabilitySummary availability={provider.availability} desiredDays={desiredDays} readAt={readAt} />}
      <div className="mb-5 flex flex-wrap gap-2" aria-label="服务方擅长标签">
        {provider.tags.length ? provider.tags.map((tag, index) => (
          <span className="rounded-full bg-mist px-3 py-1 text-[13px] text-ink-2" key={`${tag}-${index}`}>{tag}</span>
        )) : <span className={C.meta}>暂无专长信息</span>}
      </div>
      <div className="border-t border-line pt-4">
        <h4 className="mb-3 text-[15px] font-semibold">为什么匹配</h4>
        <ul className="space-y-2 text-[15px] text-ink-2">
          {reasons.map((reason) => <li className="flex gap-2" key={reason}><span className="text-brand" aria-hidden="true">•</span><span>{reason}</span></li>)}
        </ul>
      </div>
    </article>
  );
}
