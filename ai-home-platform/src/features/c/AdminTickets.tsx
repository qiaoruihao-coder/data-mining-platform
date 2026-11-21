"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Empty, Explainer, PageHeader } from "@/components/ui";
import { AdminTicketSummary } from "./AdminTicketSummary";
import { DemandAccessRecovery } from "./DemandAccessRecovery";
import {
  adminTicketsFailureState, filterTickets, loadAdminTickets, ticketCategoryFilterLabels,
  ticketCategoryFilterOptions, ticketCategoryLabels, ticketStatusFilterLabels, ticketStatusFilterOptions,
  ticketStatusLabels, type AdminTicketsState, type TicketCategoryFilter, type TicketStatusFilter,
} from "./admin-tickets";

export function AdminTicketsContent({ state, onReload }: {
  state: AdminTicketsState;
  onReload: () => void;
}) {
  const response = state.status === "ready" ? state.response : null;
  const [categoryFilter, setCategoryFilter] = useState<TicketCategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<TicketStatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const filteredTickets = response ? filterTickets(response.data, categoryFilter, statusFilter, searchQuery) : [];
  const hasActiveFilter = categoryFilter !== "all" || statusFilter !== "all" || searchQuery.trim().length > 0;

  function clearFilters() {
    setCategoryFilter("all");
    setStatusFilter("all");
    setSearchQuery("");
  }

  return (
    <section aria-labelledby="admin-tickets-title" className="space-y-6">
      <PageHeader
        id="admin-tickets-title"
        title="售后工单"
        subtitle="查看工单问题、当前状态及关联需求。"
        aside={
          <Button onClick={onReload} variant="secondary" disabled={state.status === "loading"}>
            {state.status === "loading" ? "正在加载…" : state.status === "error" ? "重新加载" : "刷新工单"}
          </Button>
        }
      />

      <Explainer summary="工单说明">
        <p>模拟记录已标注。</p>
        <p>仅供查看，暂不支持派单或处理。</p>
        <p>当前为模拟工单，不含真实售后记录。</p>
      </Explainer>

      {state.status === "loading" && <div className={C.card} role="status" aria-live="polite">正在加载工单…</div>}
      {state.status === "error" && (
        <div className={`${C.card} border-danger/30`} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载售后工单</h2>
          <p className="!mb-0">{state.message}</p>
          {state.canExitOwnerSession && <DemandAccessRecovery context="admin-tickets" />}
        </div>
      )}

      {response && (
        <>
          <div role="status" aria-live="polite" className="space-y-2">
            <StatusBadge label={response.meta.source === "mock"
              ? response.data.length === 0 ? "工单列表来源：模拟标识（mock）" : "工单列表来源：含模拟数据"
              : "工单列表来源：已保存记录"} />
            <p className={`!mb-0 ${C.meta}`}>
              {response.meta.source === "mock"
                ? response.data.length === 0
                  ? "本次为空列表，接口来源标记为 mock；没有可展示的工单。"
                  : "本次列表含模拟数据，仅供演示参考，不能据此认定真实售后已受理或已解决。来源标识针对整份列表，不用于判断每条工单的来源。"
                : "本次工单列表由实时接口返回，来源标识不代表已完成身份鉴权。"}
            </p>
            <p className={`num !mb-0 ${C.meta}`}>本次返回 {response.data.length} 条工单</p>
          </div>

          <AdminTicketSummary tickets={response.data} source={response.meta.source} />

          {response.data.length === 0 ? (
            <Empty title="暂无工单" hint="稍后刷新查看。" />
          ) : (
            <>
              <section aria-labelledby="admin-ticket-filters-title" className={`${C.card} space-y-4`}>
                <div>
                  <h2 id="admin-ticket-filters-title" className={`!mb-1 ${C.sectionTitle}`}>筛选当前列表</h2>
                  <p className={`!mb-0 ${C.meta}`}>按编号、分类或状态筛选。</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <label className={`${C.label} ${C.labelText}`} htmlFor="admin-ticket-search">
                    关键词
                    <input
                      id="admin-ticket-search"
                      type="search"
                      className={`${C.input} block font-normal`}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="工单、需求或服务方编号"
                    />
                  </label>
                  <label className={`${C.label} ${C.labelText}`} htmlFor="admin-ticket-category-filter">
                    问题分类
                    <select
                      id="admin-ticket-category-filter"
                      className={`${C.input} block font-normal`}
                      value={categoryFilter}
                      onChange={(event) => setCategoryFilter(event.target.value as TicketCategoryFilter)}
                    >
                      {ticketCategoryFilterOptions.map((category) => (
                        <option key={category} value={category}>{ticketCategoryFilterLabels[category]}</option>
                      ))}
                    </select>
                  </label>
                  <label className={`${C.label} ${C.labelText}`} htmlFor="admin-ticket-status-filter">
                    当前状态
                    <select
                      id="admin-ticket-status-filter"
                      className={`${C.input} block font-normal`}
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as TicketStatusFilter)}
                    >
                      {ticketStatusFilterOptions.map((status) => (
                        <option key={status} value={status}>{ticketStatusFilterLabels[status]}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <p role="status" aria-live="polite" className="num !mb-0 text-[15px] text-ink-2">
                    当前显示 {filteredTickets.length} / {response.data.length} 条工单
                  </p>
                  {hasActiveFilter && <Button onClick={clearFilters} variant="ghost" size="sm">清除筛选</Button>}
                </div>
              </section>
              {filteredTickets.length === 0 ? (
                <div className={`${C.card} border-line`} role="status">
                  <h2 className={C.sectionTitle}>当前筛选没有工单</h2>
                  <p className="text-ink-2">本次接口已返回 {response.data.length} 条工单，但没有符合当前关键词、分类和状态的记录。</p>
                  <Button onClick={clearFilters} variant="secondary">清除筛选并显示全部</Button>
                </div>
              ) : (
                <ul aria-label="售后工单列表" className="m-0 list-none space-y-4 p-0">
                  {filteredTickets.map((ticket) => (
                    <li key={ticket.id}>
                      <article aria-label={`工单 ${ticket.id}`} className={`${C.card} min-w-0`}>
                        <h2 className={`!mb-2 ${C.sectionTitle} break-all`}>工单编号：{ticket.id}</h2>
                        <p className="max-w-[38em] whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {ticket.description.trim() ? ticket.description : "暂未填写问题描述。"}
                        </p>
                        <dl className="m-0 grid gap-4 border-t border-line pt-4 text-[15px] sm:grid-cols-3">
                          <div>
                            <dt className={C.meta}>问题分类</dt>
                            <dd className="m-0 mt-1">{ticketCategoryLabels[ticket.category]}</dd>
                          </div>
                          <div>
                            <dt className={C.meta}>当前状态</dt>
                            <dd className="m-0 mt-1"><StatusBadge label={ticketStatusLabels[ticket.status]} /></dd>
                          </div>
                          <div className="min-w-0">
                            <dt className={C.meta}>责任服务方编号</dt>
                            <dd className="m-0 mt-1 break-all">
                              {ticket.responsibleProviderId ?? "暂未指定责任服务方"}
                              {ticket.responsibleProviderId !== null && (
                                <Link href={`/admin/provider/${encodeURIComponent(ticket.responsibleProviderId)}`} prefetch={false}
                                  aria-label={`查看工单 ${ticket.id} 的责任服务方资料`}
                                  className="mt-1 block w-fit text-[14px] font-medium underline">
                                  查看责任服务方资料
                                </Link>
                              )}
                            </dd>
                          </div>
                        </dl>
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                          <p className={`min-w-0 break-all !mb-0 ${C.meta}`}>需求编号：{ticket.demandId}</p>
                          <Link href={`/admin/demand/${encodeURIComponent(ticket.demandId)}`} prefetch={false}
                            aria-label={`查看工单 ${ticket.id} 的关联需求`}
                            className={`${C.btnBase} ${C.btnSecondary} ${C.btnSm}`}>
                            查看关联需求
                          </Link>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function AdminTickets() {
  const [state, setState] = useState<AdminTicketsState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadAdminTickets().then(
      (response) => { if (active) setState({ status: "ready", response }); },
      (error: unknown) => { if (active) setState(adminTicketsFailureState(error)); },
    );
    return () => { active = false; };
  }, [reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey((previous) => previous + 1);
  }

  return <AdminTicketsContent state={state} onReload={reload} />;
}
