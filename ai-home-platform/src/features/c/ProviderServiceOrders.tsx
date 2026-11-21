"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Empty, Explainer, PageHeader } from "@/components/ui";
import { ProviderOrderQuote } from "./ProviderOrderQuote";
import {
  filterServiceOrders, loadProviderServiceOrders, providerServiceOrdersErrorMessage,
  serviceOrderFilterLabels, serviceOrderFilterOptions, serviceOrderStatusLabels, summarizeServiceOrders,
  type ProviderServiceOrdersState, type ServiceOrderStatusFilter,
} from "./provider-service-orders";

export function ProviderServiceOrdersContent({ state, onReload, statusFilter, onStatusFilterChange }: {
  state: ProviderServiceOrdersState;
  onReload: () => void;
  statusFilter: ServiceOrderStatusFilter;
  onStatusFilterChange: (status: ServiceOrderStatusFilter) => void;
}) {
  const response = state.status === "ready" ? state.response : null;
  const summary = response ? summarizeServiceOrders(response.data) : null;
  const visibleOrders = response ? filterServiceOrders(response.data, statusFilter) : [];

  return (
    <section aria-labelledby="provider-service-orders-title" className="space-y-5">
      <PageHeader
        id="provider-service-orders-title"
        title="我的接单"
        subtitle="查看您的订单和进度。"
        aside={
          <Button onClick={onReload} variant="secondary" disabled={state.status === "loading"}>
            {state.status === "loading" ? "正在加载接单…" : state.status === "error" ? "重新加载接单" : "刷新接单"}
          </Button>
        }
      />
      <Explainer summary="订单说明">
        <p>切换账号后，请刷新订单和报价。</p>
        <p>订单仅供查看，暂不支持取消或修改。合同、付款和验收另行确认。</p>
      </Explainer>
      {state.status === "loading" && <div className={C.card} role="status">正在加载订单…</div>}
      {state.status === "error" && (
        <div className={`${C.card} border-danger/30`} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载本人接单</h2>
          <p className="!mb-0">{state.message}</p>
        </div>
      )}
      {response && summary && (
        <>
          <div role="status" aria-live="polite" className="space-y-2">
            <StatusBadge label={response.meta.source === "mock" ? "含模拟订单" : "已保存订单"} />
            <p className={`!mb-0 ${C.meta}`}>
              {response.meta.source === "mock"
                ? "模拟订单已单独标注。"
                : "以下为已保存订单。"}
              订单进展以双方确认记录为准。
            </p>
            <p className={`num !mb-0 ${C.meta}`}>本次返回 {response.data.length} 条接单关系，按编号排列，不代表成交时间顺序。</p>
          </div>
          <section aria-labelledby="provider-order-filters-title" className={`${C.card} space-y-4`}>
            <div>
              <h2 id="provider-order-filters-title" className={`!mb-1 ${C.sectionTitle}`}>按接单状态查看</h2>
              <p className={`!mb-0 ${C.meta}`}>按状态筛选订单，刷新可查看最新进度。</p>
            </div>
            <div role="group" aria-label="按接单状态筛选" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {serviceOrderFilterOptions.map(status => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusFilter === status}
                  onClick={() => onStatusFilterChange(status)}
                  className={`num ${C.btnBase} ${statusFilter === status ? C.btnPrimary : C.btnSecondary}`}
                >
                  {serviceOrderFilterLabels[status]}（{status === "all" ? summary.total : summary.byStatus[status]}）
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="num !mb-0 text-[15px] text-ink-2" role="status" aria-live="polite">当前筛选：{serviceOrderFilterLabels[statusFilter]}，显示 {visibleOrders.length} / {summary.total} 条接单。</p>
              {statusFilter !== "all" && <Button variant="secondary" size="sm" onClick={() => onStatusFilterChange("all")}>清除状态筛选</Button>}
            </div>
          </section>
          {response.data.length === 0 ? (
            <Empty title="暂无订单" hint="业主确认报价后，订单显示在这里。" />
          ) : visibleOrders.length === 0 ? (
            <Empty title="当前状态下没有接单" hint="试试其他状态，或清除筛选。" />
          ) : (
            <ul aria-label="本人接单列表" className="m-0 list-none space-y-4 p-0">
              {visibleOrders.map(order => (
                <li key={order.id}>
                  <article aria-label={`接单 ${order.id}`} className={`${C.card} min-w-0`}>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <StatusBadge label={serviceOrderStatusLabels[order.status]} />
                      <StatusBadge label={order.source === "mock" ? "模拟订单" : "已保存订单"} />
                    </div>
                    <h2 className={`!mb-0 ${C.sectionTitle} break-all`}>订单编号：{order.id}</h2>
                    <dl className="m-0 mt-4 grid gap-4 border-t border-line pt-4 text-[15px] sm:grid-cols-3">
                      <div className="min-w-0">
                        <dt className={C.meta}>需求编号</dt>
                        <dd className="m-0 mt-1 break-all">
                          <Link
                            href={`/provider/demand/${encodeURIComponent(order.demandId)}`}
                            prefetch={false}
                            aria-label={`查看关联需求 ${order.demandId}`}
                            className="font-medium underline"
                          >{order.demandId}</Link>
                        </dd>
                      </div>
                      <div className="min-w-0"><dt className={C.meta}>已接受报价编号</dt><dd className="m-0 mt-1 break-all">{order.acceptedQuoteId}</dd></div>
                      <div className="min-w-0"><dt className={C.meta}>服务方编号</dt><dd className="m-0 mt-1 break-all">{order.providerId}</dd></div>
                    </dl>
                    <ProviderOrderQuote order={order} />
                  </article>
                </li>
              ))}
            </ul>
          )}
          <p className={`!mb-0 ${C.meta}`}>展开订单可查看报价、费用和工期。待确认费用需另行核实。</p>
        </>
      )}
    </section>
  );
}

export function ProviderServiceOrders() {
  const [state, setState] = useState<ProviderServiceOrdersState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ServiceOrderStatusFilter>("all");
  useEffect(() => {
    let active = true;
    loadProviderServiceOrders().then(
      response => { if (active) setState({ status: "ready", response }); },
      error => { if (active) setState({ status: "error", message: providerServiceOrdersErrorMessage(error) }); },
    );
    return () => { active = false; };
  }, [reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey(previous => previous + 1);
  }
  return <ProviderServiceOrdersContent state={state} onReload={reload} statusFilter={statusFilter} onStatusFilterChange={setStatusFilter} />;
}
