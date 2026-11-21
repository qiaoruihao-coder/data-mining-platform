"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Explainer, PageHeader } from "@/components/ui";
import { DemandSource } from "./DemandSource";
import { DemandAccessRecovery } from "./DemandAccessRecovery";
import {
  defaultDemandHallFilters,
  demandHallFailureState,
  demandHallRenovationOptions,
  filterHallDemands,
  formatBudget,
  loadDemandHall,
  renovationLabels,
  type DemandHallState,
  type DemandHallFilters,
} from "./demand-hall";

export function DemandHallContent({
  state,
  onReload,
  filters = defaultDemandHallFilters,
  onFiltersChange = () => {},
}: {
  state: DemandHallState;
  onReload: () => void;
  filters?: DemandHallFilters;
  onFiltersChange?: (filters: DemandHallFilters) => void;
}) {
  const visibleDemands = state.status === "ready" ? filterHallDemands(state.response.data, filters) : [];
  const hasFilters = filters.keyword.length > 0 || filters.renovationType !== "all";
  return (
    <section aria-labelledby="demand-hall-title">
      <PageHeader
        id="demand-hall-title"
        title="需求大厅"
        subtitle="查看装修需求与预算。"
        aside={
          <Button variant="secondary" onClick={onReload} disabled={state.status === "loading"}>
            {state.status === "loading"
              ? "正在加载…"
              : state.status === "error"
                ? "重新加载"
                : "刷新需求"}
          </Button>
        }
      />

      <Explainer summary="使用说明">
        <p>
          登录服务方后可查看需求并报价。固定演示需求仅供查看；账号尚未完成资质认证。
        </p>
        <aside aria-label="需求大厅登录提示">
          <p className="!mb-2">同时登录业主和服务方时，只显示该业主的需求。</p>
          <p className="!mb-2">查看公开需求前，请退出业主登录并刷新。也可用两个浏览器分别登录。</p>
        </aside>
        {state.status === "ready" && (
          <p>
            卡片会标注模拟或来源待确认的需求。
          </p>
        )}
      </Explainer>

      {state.status === "loading" && (
        <div className={C.card} role="status" aria-live="polite">
          正在读取需求，请稍候…
        </div>
      )}

      {state.status === "error" && (
        <div className={C.card} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载需求</h2>
          <p className="!mb-0">{state.message}</p>
          {state.canExitOwnerSession && <DemandAccessRecovery />}
        </div>
      )}

      {state.status === "ready" && (
        <>
          <div role="status" aria-live="polite" className="mb-4 flex flex-wrap items-center gap-3">
            <StatusBadge
              label={
                state.response.meta.source === "mock"
                  ? "含模拟数据"
                  : "已保存记录"
              }
            />
            <span className={`num ${C.meta}`}>
              本次读取的已发布需求共 {state.response.data.length} 条。
            </span>
          </div>

          <section aria-labelledby="demand-hall-filters-title" className={`${C.card} mb-6 space-y-4`}>
            <div>
              <h2 id="demand-hall-filters-title" className={`!mb-1 ${C.sectionTitle}`}>筛选已发布需求</h2>
              <p className={`!mb-0 ${C.meta}`}>按关键词或改造类型查找需求。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="demand-hall-keyword" className={`${C.label} ${C.labelText} mb-2`}>关键词</label>
                <input id="demand-hall-keyword" type="search" className={`${C.input} w-full min-w-0`}
                  value={filters.keyword} aria-describedby="demand-hall-keyword-hint"
                  onChange={event => onFiltersChange({ ...filters, keyword: event.target.value })} />
                <p id="demand-hall-keyword-hint" className={`${C.meta} mt-2 !mb-0`}>搜索城市、需求描述或编号。</p>
              </div>
              <div className="min-w-0">
                <label htmlFor="demand-hall-renovation" className={`${C.label} ${C.labelText} mb-2`}>改造类型</label>
                <select id="demand-hall-renovation" className={`${C.input} w-full min-w-0`} value={filters.renovationType}
                  onChange={event => onFiltersChange({ ...filters, renovationType: demandHallRenovationOptions.find(value => value === event.target.value) ?? "all" })}>
                  {demandHallRenovationOptions.map(value => <option key={value} value={value}>{value === "all" ? "全部类型" : renovationLabels[value]}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="status" aria-live="polite" className="num !mb-0 text-[15px] text-ink-2">当前显示 {visibleDemands.length} / {state.response.data.length} 条已发布需求。</p>
              {hasFilters && <Button type="button" variant="secondary" size="sm" onClick={() => onFiltersChange(defaultDemandHallFilters)}>清除筛选</Button>}
            </div>
          </section>

          {state.response.data.length === 0 ? (
            <div className={C.card}>
              <h2 className={C.sectionTitle}>暂无已发布需求</h2>
              <p className="!mb-0 text-ink-2">当前没有可展示的需求，请稍后刷新。</p>
            </div>
          ) : visibleDemands.length === 0 ? (
            <div className={C.card} role="status">
              <h2 className={C.sectionTitle}>没有符合筛选条件的需求</h2>
              <p className="!mb-0 text-ink-2">换个关键词或清除筛选试试。</p>
            </div>
          ) : (
            <ul aria-label="已发布需求列表" className="m-0 grid list-none gap-6 p-0 md:grid-cols-2">
              {visibleDemands.map((demand) => (
                <li key={demand.id} className={`${C.card} flex min-w-0 flex-col`}>
                  <article aria-labelledby={`demand-${demand.id}`} className="flex flex-1 flex-col">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <StatusBadge label="已发布" />
                      <DemandSource source={demand.source} />
                    </div>
                    <h2 id={`demand-${demand.id}`} className={`!mb-2 break-words ${C.sectionTitle}`}>
                      {demand.city} {renovationLabels[demand.renovationType]}
                    </h2>
                    <p className="whitespace-pre-wrap break-words text-ink-2">
                      {demand.description || "业主暂未填写需求描述。"}
                    </p>
                    <dl className="num m-0 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-4">
                      <div className="col-span-2">
                        <dt className={C.meta}>业主预算</dt>
                        <dd className="m-0 mt-0.5 break-words text-[20px] font-semibold text-brand-hover">
                          {formatBudget(demand.budgetMinCents)} – {formatBudget(demand.budgetMaxCents)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className={C.meta}>所在城市</dt>
                        <dd className="m-0 mt-0.5 break-words font-medium">{demand.city}</dd>
                      </div>
                      <div>
                        <dt className={C.meta}>改造面积</dt>
                        <dd className="m-0 mt-0.5 font-medium">{demand.areaM2} 平方米</dd>
                      </div>
                      <div>
                        <dt className={C.meta}>期望工期</dt>
                        <dd className="m-0 mt-0.5 font-medium">{demand.desiredDays} 天</dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5">
                      <span className={`break-all ${C.meta}`}>需求编号：{demand.id}</span>
                      <Link
                        href={`/provider/demand/${encodeURIComponent(demand.id)}`}
                        aria-label={`查看需求 ${demand.id} 的详情`}
                        className={`${C.btnBase} ${C.btnSecondary} ${C.btnSm}`}
                      >
                        查看需求详情
                      </Link>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function DemandHall() {
  const [state, setState] = useState<DemandHallState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [filters, setFilters] = useState<DemandHallFilters>(defaultDemandHallFilters);

  useEffect(() => {
    let active = true;
    loadDemandHall().then(
      (response) => {
        if (active) setState({ status: "ready", response });
      },
      (error: unknown) => {
        if (active) setState(demandHallFailureState(error));
      },
    );
    return () => {
      active = false;
    };
  }, [reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  return <DemandHallContent state={state} onReload={reload} filters={filters} onFiltersChange={setFilters} />;
}
