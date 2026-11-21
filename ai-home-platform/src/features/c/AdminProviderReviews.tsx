"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Source, type SourceDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Empty, Explainer, PageHeader } from "@/components/ui";
import {
  adminProviderReviewsFailure, defaultAdminProviderReviewFilters, filterAdminProviderReviews,
  loadAdminProviderReviews, reviewSampleLabels, reviewSampleOptions, reviewSourceLabels,
  type AdminProviderReviewFilters, type AdminProviderReviewsState,
} from "./admin-provider-reviews";

type ContentProps = {
  source: SourceDTO;
  state: AdminProviderReviewsState;
  onSourceChange: (source: SourceDTO) => void;
  onReload: () => void;
  filters: AdminProviderReviewFilters;
  onFiltersChange: (filters: AdminProviderReviewFilters) => void;
};

export function AdminProviderReviewsContent({ source, state, onSourceChange, onReload, filters, onFiltersChange }: ContentProps) {
  const response = state.status === "ready" ? state.response : null;
  const visibleProviders = response ? filterAdminProviderReviews(response.data, filters) : [];
  const hasFilters = filters.keyword.length > 0 || filters.sampleState !== "all";
  return <section aria-labelledby="admin-provider-reviews-title" className="space-y-6">
    <nav aria-label="评价汇总返回导航">
      <Link href="/admin" className="text-[15px] font-medium hover:underline">返回管理看板</Link>
    </nav>
    <PageHeader id="admin-provider-reviews-title" title="服务方评价汇总" subtitle="查看完工评价与样本数。" />
    <Explainer summary="评价说明">
      <p>当前目录为模拟服务方。</p>
      <p>真实与模拟评价分开统计。仅展示汇总，不代表质量认证。</p>
    </Explainer>
    <div className="flex flex-wrap items-end gap-3">
      <label className={`${C.label} min-w-0 max-w-full`} htmlFor="admin-review-source">
        <span className={C.labelText}>评价样本来源</span>
        <select id="admin-review-source" className={C.input} value={source} onChange={event => {
          const parsed = Source.safeParse(event.target.value);
          if (parsed.success) onSourceChange(parsed.data);
        }}>
          <option value="live">实际记录（live）</option>
          <option value="mock">模拟记录（mock）</option>
        </select>
      </label>
      <Button onClick={onReload} variant="secondary" disabled={state.status === "loading"}
       >
        {state.status === "loading" ? "正在加载…" : state.status === "error" ? "重新加载" : "刷新汇总"}
      </Button>
    </div>
    {state.status === "loading" && <div className={C.card} role="status" aria-live="polite">正在读取{reviewSourceLabels[source]}的评价汇总…</div>}
    {state.status === "error" && <div className={`${C.card} border-danger/30`} role="alert">
      <h2 className={C.sectionTitle}>暂时无法加载评价汇总</h2><p className="!mb-0">{state.message}</p>
    </div>}
    {response && <>
      <div role="status" aria-live="polite">
        <StatusBadge label={`目录响应来源：${reviewSourceLabels[response.meta.source]}`} />
        <p className={`${C.meta} mt-2 !mb-0`}>本次目录 {response.data.length} 家服务方，所选评价口径：{reviewSourceLabels[source]}。目录整体来源不覆盖各服务方的基础资料及评价来源。</p>
      </div>
      <section aria-labelledby="admin-review-filters-title" className={`${C.card} space-y-4`}>
        <h2 id="admin-review-filters-title" className={C.sectionTitle}>筛选服务方评价汇总</h2>
        <p className={`${C.pageSub} !mb-0`}>只筛选本次公开目录和所选来源的评价汇总。刷新汇总或切换评价来源会保留筛选条件；离开页面后重置。</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <label htmlFor="admin-review-keyword" className={`${C.label} mb-2`}>关键词</label>
            <input id="admin-review-keyword" type="search" className={`${C.input} w-full min-w-0`}
              value={filters.keyword} aria-describedby="admin-review-keyword-hint"
              onChange={event => onFiltersChange({ ...filters, keyword: event.target.value })} />
            <p id="admin-review-keyword-hint" className={`${C.meta} mt-2 !mb-0`}>匹配服务方名称、编号或城市；忽略首尾空格和字母大小写，按原文连续匹配。</p>
          </div>
          <div className="min-w-0">
            <label htmlFor="admin-review-samples" className={`${C.label} mb-2`}>评价样本状态</label>
            <select id="admin-review-samples" className={`${C.input} w-full min-w-0`} value={filters.sampleState}
              aria-describedby="admin-review-samples-hint" onChange={event => {
                const sampleState = reviewSampleOptions.find(value => value === event.target.value);
                if (sampleState) onFiltersChange({ ...filters, sampleState });
              }}>
              {reviewSampleOptions.map(value => <option key={value} value={value}>{reviewSampleLabels[value]}</option>)}
            </select>
            <p id="admin-review-samples-hint" className={`${C.meta} mt-2 !mb-0`}>暂无样本指所选来源为 0 条，不等于 0 分；汇总未知指接口未提供汇总，不能判断样本数。</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className={`${C.pageSub} !mb-0`}>当前显示 {visibleProviders.length} / {response.data.length} 家服务方。</p>
          {hasFilters && <Button type="button" variant="secondary" size="sm" onClick={() => onFiltersChange(defaultAdminProviderReviewFilters)}
           >清除筛选</Button>}
        </div>
      </section>
      {response.data.length === 0 ? <Empty title="暂无服务方" hint="暂无资料，可刷新重试。" /> : visibleProviders.length === 0 ? (
        <Empty title="没有符合筛选条件的服务方" hint="调整条件或清除筛选。" />
      ) : (
        <ul aria-label="服务方评价汇总列表" className="grid gap-4 md:grid-cols-2">
          {visibleProviders.map(provider => <li key={provider.id} className={`${C.card} min-w-0`}>
            <h2 className={`${C.sectionTitle} break-words [overflow-wrap:anywhere]`}>{provider.name.trim() ? provider.name : "名称未填写"}</h2>
            <p className={`${C.meta} mt-2 break-all`}>服务方编号：{provider.id}</p>
            <p className={`${C.pageSub} break-words [overflow-wrap:anywhere]`}>城市：{provider.city.trim() ? provider.city : "城市未填写"}</p>
            <StatusBadge label={`基础资料来源：${provider.source ? reviewSourceLabels[provider.source] : "未知（未提供）"}`} />
            {provider.performance ? <div className="mt-4 space-y-3 border-t border-line pt-4">
              <StatusBadge label={`评价来源：${reviewSourceLabels[provider.performance.source]}`} />
              <dl className="num m-0 grid grid-cols-2 gap-3">
                <div><dt className={C.meta}>业主评价均分（满分 5）</dt><dd className="m-0 mt-1 text-[20px] font-semibold">{provider.performance.averageRating === null ? "暂无均分" : provider.performance.averageRating.toFixed(2)}</dd></div>
                <div><dt className={C.meta}>评价样本数</dt><dd className="m-0 mt-1 text-[20px] font-semibold">{provider.performance.reviewCount} 条</dd></div>
                <div className="col-span-2 min-w-0"><dt className={C.meta}>统计计算时间（ISO 8601）</dt><dd className="m-0 mt-1 break-all text-sm"><time dateTime={provider.performance.calculatedAt}>{provider.performance.calculatedAt}</time></dd></div>
              </dl>
              {provider.performance.reviewCount === 0 && <p className={`${C.pageSub} !mb-0`}>暂无该来源样本，不能按 0 分解读，也不会使用另一来源或种子评分补齐。</p>}
              {provider.performance.reviewCount < 3 && <p className={`${C.note} ${C.noteInfo} !mb-0`}>样本少（少于 3 条），请谨慎参考。</p>}
            </div> : <p className={`${C.note} ${C.noteInfo} mt-4 !mb-0`}>未提供评价汇总，暂不能判断是否有样本。</p>}
          </li>)}
        </ul>
      )}
    </>}
  </section>;
}

function AdminProviderReviewsLoader({ source, onSourceChange, onReload, filters, onFiltersChange }: Omit<ContentProps, "state">) {
  const [state, setState] = useState<AdminProviderReviewsState>({ status: "loading" });
  useEffect(() => {
    let active = true;
    loadAdminProviderReviews(source).then(
      response => { if (active) setState({ status: "ready", response }); },
      (error: unknown) => { if (active) setState(adminProviderReviewsFailure(error)); },
    );
    return () => { active = false; };
  }, [source]);
  return <AdminProviderReviewsContent source={source} state={state} onSourceChange={onSourceChange} onReload={onReload}
    filters={filters} onFiltersChange={onFiltersChange} />;
}

export function AdminProviderReviews() {
  const [source, setSource] = useState<SourceDTO>("live");
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<AdminProviderReviewFilters>(defaultAdminProviderReviewFilters);
  // Remount on source changes and refresh: clear old results immediately and ignore late responses.
  return <AdminProviderReviewsLoader key={`${source}:${reloadKey}`} source={source} onSourceChange={setSource}
    onReload={() => setReloadKey(key => key + 1)} filters={filters} onFiltersChange={setFilters} />;
}
