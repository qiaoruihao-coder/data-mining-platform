"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Empty, Explainer, PageHeader } from "@/components/ui";
import { DemandSource } from "./DemandSource";
import { DemandAccessRecovery } from "./DemandAccessRecovery";
import { formatBudget, renovationLabels } from "./demand-hall";
import {
  adminDemandFailureState,
  adminDemandStatusLabels,
  adminDemandStatuses,
  loadAdminDemands,
  summarizeAdminDemands,
  type AdminDemandState,
} from "./admin-demand-overview";

/** 统计行的竖分隔线：手机两列、平板三列、桌面六列时，每行第一项不画左线。 */
const statDivider = ["", "border-l", "sm:border-l", "border-l sm:border-l-0 lg:border-l", "sm:border-l", "border-l"];

export function AdminDemandOverviewContent({ state, onReload }: {
  state: AdminDemandState;
  onReload: () => void;
}) {
  const response = state.status === "ready" ? state.response : null;
  const summary = response ? summarizeAdminDemands(response.data) : null;

  return (
    <section aria-labelledby="admin-demand-title" className="space-y-6">
      <PageHeader
        id="admin-demand-title"
        title="平台管理看板"
        subtitle="需求与进度概览。"
        aside={
          <Button onClick={onReload} variant="secondary" disabled={state.status === "loading"}>
            {state.status === "loading" ? "正在加载…" : state.status === "error" ? "重新加载" : "刷新概览"}
          </Button>
        }
      />

      <Explainer summary="统计说明">
        <p>模拟记录已标注。</p>
        <p>未登录业主时显示公开需求；登录业主后显示本人需求。暂不支持全站查询。</p>
        <p>切换账号后请刷新。</p>
        <p>仅统计当前列表。预算和工期为业主预期，不是成交结果。</p>
      </Explainer>

      {state.status === "loading" && <div className={C.card} role="status" aria-live="polite">正在读取需求概览，请稍候…</div>}
      {state.status === "error" && (
        <div className={`${C.card} border-danger/30`} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载需求概览</h2>
          <p className="!mb-0">{state.message}</p>
          {state.canExitOwnerSession && <DemandAccessRecovery />}
        </div>
      )}

      {response && summary && (
        <>
          <div role="status" aria-live="polite" className="space-y-2">
            <StatusBadge label={response.meta.source === "mock"
              ? response.data.length === 0 ? "列表来源：模拟标识（mock）" : "列表来源：含模拟数据"
              : "列表来源：已保存记录"} />
            <p className={`!mb-0 ${C.meta}`}>
              {response.meta.source === "mock"
                ? response.data.length === 0
                  ? "本次为空列表，接口来源标记为 mock；没有可展示的需求。"
                  : "列表包含模拟数据，也可能包含实际创建的需求；各条需求来源以行内标识为准，未提供时显示未知。"
                : "本次列表由实时接口返回，来源标识不代表已完成身份鉴权。"}
            </p>
          </div>

          <section aria-labelledby="admin-demand-counts-title">
            <h2 id="admin-demand-counts-title" className={`!mb-1 ${C.sectionTitle}`}>本次列表状态分布</h2>
            <p className={`!mb-3 ${C.meta}`}>统计包含本次返回的所有需求，包括模拟、实际创建及来源未知的记录。</p>
            <dl aria-label="本次列表需求数量" className="num m-0 grid grid-cols-2 gap-y-4 rounded-card border border-line bg-white py-5 sm:grid-cols-3 lg:grid-cols-6">
              <div className="flex flex-col-reverse px-5">
                <dt className={C.meta}>列表需求数</dt>
                <dd className="m-0 text-[32px] font-semibold leading-tight text-brand">{summary.total}</dd>
              </div>
              {adminDemandStatuses.map((status, index) => (
                <div key={status} className={`flex flex-col-reverse border-line px-5 ${statDivider[index + 1]}`}>
                  <dt className={C.meta}>{adminDemandStatusLabels[status]}</dt>
                  <dd className="m-0 text-[32px] font-semibold leading-tight">{summary.byStatus[status]}</dd>
                </div>
              ))}
            </dl>
          </section>

          {response.data.length === 0 ? (
            <Empty title="暂无需求" hint="暂无可查看的需求。" />
          ) : (
            <div role="region" aria-label="需求明细，可横向滚动" tabIndex={0}
              className={`${C.cardFlush} overflow-x-auto`}>
              <table className="w-full min-w-[640px] table-fixed text-left text-[15px]">
                <caption className="px-5 pb-3 pt-5 text-left text-[18px] font-semibold text-ink">需求预算与期望工期（人民币）</caption>
                <thead className="border-y border-line bg-canvas text-[13px] text-ink-3">
                  <tr>
                    <th scope="col" className="w-[38%] px-5 py-2.5 font-medium">需求</th>
                    <th scope="col" className="w-[16%] px-3 py-2.5 font-medium">状态</th>
                    <th scope="col" className="w-[30%] px-3 py-2.5 font-medium">业主预算</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">期望工期</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line [&_td]:align-top [&_th]:align-top">
                  {response.data.map((demand) => (
                    <tr key={demand.id}>
                      <th scope="row" className="px-5 py-4 font-normal">
                        <span className="break-words font-medium">{demand.city || "城市未填写"} {renovationLabels[demand.renovationType]}</span>
                        <span className={`mt-1 block break-all ${C.meta}`}>需求编号：{demand.id}</span>
                        <div className="mt-2"><DemandSource source={demand.source} /></div>
                        <Link href={`/admin/demand/${encodeURIComponent(demand.id)}`} prefetch={false}
                          aria-label={`查看需求 ${demand.id} 的详情`}
                          className="mt-2 inline-block text-[14px] font-medium underline">
                          查看需求详情
                        </Link>
                      </th>
                      <td className="px-3 py-4"><StatusBadge label={adminDemandStatusLabels[demand.status]} /></td>
                      <td className="num break-words px-3 py-4">{formatBudget(demand.budgetMinCents)} – {formatBudget(demand.budgetMaxCents)}</td>
                      <td className="num px-3 py-4">{demand.desiredDays} 天</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function AdminDemandOverview() {
  const [state, setState] = useState<AdminDemandState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadAdminDemands().then(
      (response) => { if (active) setState({ status: "ready", response }); },
      (error: unknown) => { if (active) setState(adminDemandFailureState(error)); },
    );
    return () => { active = false; };
  }, [reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey((previous) => previous + 1);
  }

  return <AdminDemandOverviewContent state={state} onReload={reload} />;
}
