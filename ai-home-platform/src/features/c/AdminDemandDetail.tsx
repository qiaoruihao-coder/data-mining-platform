"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { DemandDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Empty, Explainer, PageHeader } from "@/components/ui";
import { DemandSource } from "./DemandSource";
import { DemandAccessRecovery } from "./DemandAccessRecovery";
import { formatBudget, renovationLabels } from "./demand-hall";
import { adminDemandStatusLabels } from "./admin-demand-overview";
import { adminDemandDetailFailureState, loadAdminDemandDetail, type AdminDemandDetailState } from "./admin-demand-detail";

const linkClass = "text-[15px] font-medium hover:underline";

export function AdminDemandDetailContent({ demandId, state, onReload }: {
  demandId: DemandDTO["id"];
  state: AdminDemandDetailState;
  onReload: () => void;
}) {
  const response = state.status === "ready" ? state.response : null;
  const demand = response?.data;

  return (
    <section aria-labelledby="admin-demand-detail-title" className="space-y-6">
      <nav aria-label="管理端返回导航" className="flex flex-wrap gap-4">
        <Link href="/admin" className={linkClass}>返回平台看板</Link>
        <Link href="/admin/tickets" className={linkClass}>返回售后工单</Link>
      </nav>
      <PageHeader
        id="admin-demand-detail-title"
        title="管理端需求详情"
        subtitle={<span className="break-all">需求编号：{demandId}</span>}
        aside={
          <Button onClick={onReload} variant="secondary" disabled={state.status === "loading"}>
            {state.status === "loading" ? "正在加载…" : state.status === "error" ? "重新加载" : "刷新详情"}
          </Button>
        }
      />
      <Explainer summary="查看权限">
        <p>模拟记录已标注。</p>
        <p>已发布需求可公开查看。其他需求仅限业主或接单服务方查看；同时登录两种身份时，以业主权限为准。运营账号暂不具备额外读取权限。</p>
        <p>切换账号后请刷新详情。业主登录失效时，请重新登录或退出该账号。</p>
        <p>本页仅供查看。售后责任和处理结果请在工单中确认。</p>
      </Explainer>

      {state.status === "loading" && <div className={C.card} role="status" aria-live="polite">正在读取需求详情，请稍候…</div>}
      {state.status === "error" && (
        <div className={`${C.card} border-danger/30`} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载需求详情</h2>
          <p className="!mb-0">{state.message}</p>
          {state.canExitOwnerSession && <DemandAccessRecovery />}
        </div>
      )}
      {state.status === "not-found" && (
        <div role="status" aria-live="polite">
          <Empty title="需求不存在或不可查看" hint="请核对编号或刷新重试。" />
        </div>
      )}
      {response && demand && (
        <>
          <div role="status" aria-live="polite">
            <StatusBadge label={response.meta.source === "mock" ? "含模拟数据" : "已保存记录"} />
            <p className={`${C.meta} mt-2 !mb-0`}>模拟需求仅供演示；来源不明的记录请先核实。</p>
          </div>
          <article aria-labelledby="admin-demand-summary-title" className={`${C.card} min-w-0`}>
            <div className="mb-4 flex flex-wrap gap-2">
              <StatusBadge label={adminDemandStatusLabels[demand.status]} />
              <DemandSource source={demand.source} />
            </div>
            <h2 id="admin-demand-summary-title" className={`${C.sectionTitle} break-words [overflow-wrap:anywhere]`}>
              {demand.city.trim() ? demand.city : "城市未填写"} {renovationLabels[demand.renovationType]}
            </h2>
            <h3 className="mt-6 font-semibold">需求描述</h3>
            <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {demand.description.trim() ? demand.description : "暂未填写需求描述。"}
            </p>
            <dl className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="min-w-0"><dt className={C.meta}>所在城市</dt><dd className="m-0 mt-1 break-words [overflow-wrap:anywhere]">{demand.city.trim() ? demand.city : "城市未填写"}</dd></div>
              <div><dt className={C.meta}>改造类型</dt><dd className="m-0 mt-1">{renovationLabels[demand.renovationType]}</dd></div>
              <div><dt className={C.meta}>改造面积</dt><dd className="m-0 mt-1">{demand.areaM2} 平方米</dd></div>
              <div><dt className={C.meta}>期望工期</dt><dd className="m-0 mt-1">{demand.desiredDays} 天</dd></div>
              <div className="sm:col-span-2"><dt className={C.meta}>业主预算</dt><dd className="m-0 mt-1 break-words text-[22px] font-semibold text-brand">{formatBudget(demand.budgetMinCents)} – {formatBudget(demand.budgetMaxCents)}</dd></div>
            </dl>
            <p className={`${C.pageSub} mt-4 !mb-0`}>以上为业主预算与期望工期，不代表成交金额、实际工期或履约完成证明。</p>
          </article>
        </>
      )}
    </section>
  );
}

function AdminDemandDetailLoader({ demandId }: { demandId: DemandDTO["id"] }) {
  const [state, setState] = useState<AdminDemandDetailState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadAdminDemandDetail(demandId).then(
      (response) => { if (active) setState({ status: "ready", response }); },
      (error: unknown) => { if (active) setState(adminDemandDetailFailureState(error)); },
    );
    return () => { active = false; };
  }, [demandId, reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey((previous) => previous + 1);
  }

  return <AdminDemandDetailContent demandId={demandId} state={state} onReload={reload} />;
}

export function AdminDemandDetail({ demandId }: { demandId: DemandDTO["id"] }) {
  // 切换需求时立即清空旧详情，卸载后的请求不能覆盖新需求。
  return <AdminDemandDetailLoader key={demandId} demandId={demandId} />;
}
