"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Empty } from "@/components/ui";
import { formatQuoteMoney } from "./quote-form";
import { QuoteSource } from "./QuoteSource";
import { ProviderQuoteDetails } from "./ProviderQuoteDetails";
import {
  defaultProviderQuoteFilters,
  filterProviderQuotes,
  loadProviderOrders,
  providerOrderStatusLabels,
  providerOrdersErrorMessage,
  providerQuoteStatusOptions,
  summarizeProviderOrders,
  type ProviderOrdersState,
  type ProviderQuoteFilters,
} from "./provider-orders";

function QuoteStatus({ status }: { status: keyof typeof providerOrderStatusLabels }) {
  return <StatusBadge label={providerOrderStatusLabels[status]} />;
}

export function ProviderOrdersContent({ state, onReload, filters = defaultProviderQuoteFilters, onFiltersChange = () => {} }: {
  state: ProviderOrdersState;
  onReload: () => void;
  filters?: ProviderQuoteFilters;
  onFiltersChange?: (filters: ProviderQuoteFilters) => void;
}) {
  const response = state.status === "ready" ? state.response : null;
  const summary = response ? summarizeProviderOrders(response.data) : null;
  const visibleQuotes = response ? filterProviderQuotes(response.data, filters) : [];
  const hasFilters = filters.status !== "all" || filters.keyword.length > 0;

  return (
    <section aria-labelledby="provider-orders-title" className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-line pt-8">
        <div className="min-w-0">
          <h2 id="provider-orders-title" className="!mb-1">本人报价</h2>
          <p className={`!mb-0 ${C.pageSub}`}>查看您提交的报价。</p>
        </div>
        <Button onClick={onReload} variant="secondary" disabled={state.status === "loading"}>
          {state.status === "loading" ? "正在加载…" : state.status === "error" ? "重新加载" : "刷新报价"}
        </Button>
      </div>

      <aside aria-label="报价说明" className={`${C.note} ${C.noteInfo} text-[13px] [&>p]:!mb-1.5 [&>p:last-child]:!mb-0`}>
        <p>请先登录服务方。切换账号后需刷新报价。</p>
        <p>提交报价后需等待业主确认，订单以“我的接单”为准。</p>
        {response && <p>模拟报价已单独标注，来源不明的报价请先核实。</p>}
      </aside>

      {state.status === "loading" && <div className={C.card} role="status" aria-live="polite">正在加载报价…</div>}
      {state.status === "error" && (
        <div className={`${C.card} border-danger/30`} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载本人报价</h2>
          <p className="!mb-0">{state.message}</p>
        </div>
      )}

      {response && summary && (
        <>
          <div role="status" aria-live="polite" className="space-y-2">
            <StatusBadge label={response.meta.source === "mock" ? "含模拟报价" : "已保存报价"} />
            <p className={`!mb-0 ${C.meta}`}>
              {response.meta.source === "mock"
                ? response.data.length === 0
                  ? "本次为空列表，演示身份查询标记为 mock；当前服务方没有已保存的报价。"
                  : "模拟报价也会保存，可继续查看。"
                : "以下为已保存报价。"}
            </p>
          </div>

          <section aria-labelledby="provider-order-counts-title">
            <h3 id="provider-order-counts-title" className={`!mb-1 ${C.sectionTitle}`}>本次查询的本人报价状态</h3>
            <p className={`!mb-3 ${C.meta}`}>统计全部报价，列表按编号排列。</p>
            <dl aria-label="本人报价状态数量" className="num m-0 grid grid-cols-2 gap-y-4 rounded-card border border-line bg-white py-4 sm:grid-cols-4">
              {(["draft", "submitted", "accepted", "rejected"] as const).map((status, index) => (
                <div key={status} className={`flex flex-col-reverse px-5 ${index % 2 === 1 ? "border-l border-line" : ""} ${index === 2 ? "sm:border-l sm:border-line" : ""}`}>
                  <dt className={C.meta}>{providerOrderStatusLabels[status]}</dt>
                  <dd className="m-0 text-[28px] font-semibold leading-tight">{summary[status]}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby="provider-quote-filters-title" className={`${C.card} space-y-4`}>
            <div>
            <h3 id="provider-quote-filters-title" className={`!mb-1 ${C.sectionTitle}`}>筛选本人报价</h3>
            <p id="provider-quote-filters-help" className={`!mb-0 ${C.meta}`}>按状态、报价编号或需求编号筛选。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="provider-quote-status" className={`${C.label} ${C.labelText} mb-2`}>报价状态</label>
                <select id="provider-quote-status" className={C.input} value={filters.status}
                  aria-describedby="provider-quote-filters-help"
                  onChange={event => onFiltersChange({ ...filters, status: event.target.value as ProviderQuoteFilters["status"] })}>
                  {providerQuoteStatusOptions.map(status => <option key={status} value={status}>{status === "all" ? "全部报价" : providerOrderStatusLabels[status]}</option>)}
                </select>
              </div>
              <div className="min-w-0">
                <label htmlFor="provider-quote-keyword" className={`${C.label} ${C.labelText} mb-2`}>报价或需求编号</label>
                <input id="provider-quote-keyword" type="search" className={C.input} value={filters.keyword}
                  aria-describedby="provider-quote-filters-help" autoComplete="off"
                  onChange={event => onFiltersChange({ ...filters, keyword: event.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="status" aria-live="polite" className="num !mb-0 text-[15px] text-ink-2">显示 {visibleQuotes.length} / {response.data.length} 条本人报价。</p>
              <Button variant="secondary" size="sm" disabled={!hasFilters} onClick={() => onFiltersChange(defaultProviderQuoteFilters)}>清除报价筛选</Button>
            </div>
          </section>

          {response.data.length === 0 ? (
            <Empty title="暂无报价" hint="可前往需求大厅报价。" />
          ) : visibleQuotes.length === 0 ? (
            <Empty title="没有符合筛选条件的报价" hint="调整条件或清除筛选。" />
          ) : (
            <ul aria-label="本人报价列表" className="m-0 list-none space-y-4 p-0">
              {visibleQuotes.map((quote) => {
                const hasPending = quote.pendingItems.length > 0 || quote.items.some((item) => item.unitPriceCents === null || item.amountCents === null);
                return (
                <li key={quote.id} className={C.card}>
                  <article aria-labelledby={`provider-quote-${quote.id}`}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <QuoteStatus status={quote.status} />
                      <QuoteSource source={quote.source} />
                      <span className={`${C.meta} min-w-0 break-all`}>报价编号：{quote.id}</span>
                    </div>
                    <h3 id={`provider-quote-${quote.id}`} className={`!mb-0 break-all ${C.sectionTitle}`}>关联需求：{quote.demandId}</h3>
                    <dl className="num m-0 mt-4 grid grid-cols-1 gap-4 border-t border-line pt-4 text-[15px] sm:grid-cols-2">
                      <div>
                        <dt className={C.meta}>报价服务方编号</dt>
                        <dd className="m-0 mt-1 break-all font-medium">{quote.providerId}</dd>
                      </div>
                      <div>
                        <dt className={C.meta}>已知费用小计</dt>
                        <dd className="m-0 mt-1 font-medium">{formatQuoteMoney(quote.knownTotalCents)}</dd>
                      </div>
                      <div>
                        <dt className={C.meta}>预计工期</dt>
                        <dd className="m-0 mt-1 font-medium">{quote.estimatedDays} 天</dd>
                      </div>
                      <div>
                        <dt className={C.meta}>待确认费用</dt>
                        <dd className="m-0 mt-1 font-medium">{hasPending ? "有，完整总价未确定" : quote.items.length === 0 ? "未提供明细，无法确认" : "暂无"}</dd>
                      </div>
                    </dl>
                    <p className={`mt-4 ${C.meta}`}>小计不含待确认费用，工期需双方确认。</p>
                    <ProviderQuoteDetails quote={quote} />
                    <Link href={`/provider/demand/${encodeURIComponent(quote.demandId)}`} prefetch={false}
                      className={`mt-4 ${C.btnBase} ${C.btnSecondary} ${C.btnSm}`}>
                      查看关联需求
                    </Link>
                    <p className={`mt-2 !mb-0 ${C.meta}`}></p>
                  </article>
                </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function ProviderOrders() {
  const [state, setState] = useState<ProviderOrdersState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<ProviderQuoteFilters>(defaultProviderQuoteFilters);

  useEffect(() => {
    let active = true;
    loadProviderOrders().then(
      (response) => { if (active) setState({ status: "ready", response }); },
      (error: unknown) => { if (active) setState({ status: "error", message: providerOrdersErrorMessage(error) }); },
    );
    return () => { active = false; };
  }, [reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey((previous) => previous + 1);
  }

  return <ProviderOrdersContent state={state} onReload={reload} filters={filters} onFiltersChange={setFilters} />;
}
