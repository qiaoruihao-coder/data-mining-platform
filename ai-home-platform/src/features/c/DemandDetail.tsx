"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Explainer, PageHeader } from "@/components/ui";
import { DemandSource } from "./DemandSource";
import { DemandAccessRecovery } from "./DemandAccessRecovery";
import { QuoteForm } from "./QuoteForm";
import { formatBudget, renovationLabels } from "./demand-hall";
import {
  demandDetailFailureState,
  demandDetailStatusLabels,
  loadDemandDetail,
  type DemandDetailState,
} from "./demand-detail";

export function DemandDetailContent({
  demandId,
  state,
  onReload,
}: {
  demandId: string;
  state: DemandDetailState;
  onReload: () => void;
}) {
  const demand = state.status === "ready" ? state.response.data : null;

  return (
    <section aria-labelledby="demand-detail-title">
      <Link href="/provider" className="mb-4 inline-block text-[15px] font-medium">
        返回需求大厅
      </Link>
      <PageHeader
        id="demand-detail-title"
        title="需求详情"
        subtitle={<span className="break-all">需求编号：{demandId}</span>}
        aside={
          <Button variant="secondary" onClick={onReload} disabled={state.status === "loading"}>
            {state.status === "loading"
              ? "正在加载…"
              : state.status === "error"
                ? "重新加载"
                : "刷新详情"}
          </Button>
        }
      />
      <Explainer summary="查看与报价说明">
        <p>
          当前为服务方演示入口，模拟数据仅用于演示，数据来源以加载后的标识为准。角色导航不代表登录鉴权。
        </p>
        <p>
          此页面展示接口授权可读的已发布或已接单需求；仅已发布需求可填写报价，状态以刷新结果为准。
        </p>
        {state.status === "ready" && (
          <p>
            当前需求来源以详情内标识为准，未提供时显示未知；模拟需求不代表真实客户需求。数据来源标识不代表已完成身份鉴权。
          </p>
        )}
      </Explainer>

      {state.status === "loading" && (
        <div className={C.card} role="status" aria-live="polite">
          正在读取需求详情，请稍候…
        </div>
      )}
      {state.status === "error" && (
        <div className={C.card} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载详情</h2>
          <p className="!mb-0">{state.message}</p>
          {state.canExitOwnerSession && <DemandAccessRecovery />}
        </div>
      )}
      {state.status === "not-found" && (
        <div className={C.card} role="status" aria-live="polite">
          <h2 className={C.sectionTitle}>需求不存在或不可查看</h2>
          <p className="!mb-0 text-ink-2">该需求可能已删除或当前不可访问。请返回需求大厅，或刷新详情重试。</p>
        </div>
      )}
      {state.status === "ready" && (
        <>
          <div role="status" aria-live="polite" className="mb-4">
            <StatusBadge
              label={state.response.meta.source === "mock"
                ? "含模拟数据"
                : "已保存记录"}
            />
          </div>
          {demand ? (
            <>
              <article className={`${C.card} mb-6 min-w-0`} aria-labelledby="demand-summary-title">
                <div className="mb-3 flex flex-wrap gap-2">
                  <StatusBadge label={demandDetailStatusLabels[demand.status]} />
                  <DemandSource source={demand.source} />
                </div>
                <h2 id="demand-summary-title" className="!mb-0 break-words">
                  {demand.city} {renovationLabels[demand.renovationType]}
                </h2>
                <h3 className="mb-1 mt-5 text-[15px] font-semibold text-ink-2">需求描述</h3>
                <p className="max-w-[38em] whitespace-pre-wrap break-words">
                  {demand.description || "业主暂未填写需求描述。"}
                </p>
                <dl className="num m-0 mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
                  <div className="col-span-2 sm:col-span-4">
                    <dt className={C.meta}>业主预算</dt>
                    <dd className="m-0 mt-0.5 break-words text-[22px] font-semibold text-brand-hover">
                      {formatBudget(demand.budgetMinCents)} – {formatBudget(demand.budgetMaxCents)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={C.meta}>所在城市</dt>
                    <dd className="m-0 mt-0.5 break-words font-medium">{demand.city}</dd>
                  </div>
                  <div>
                    <dt className={C.meta}>改造类型</dt>
                    <dd className="m-0 mt-0.5 font-medium">{renovationLabels[demand.renovationType]}</dd>
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
                <p className={`!mb-0 mt-4 ${C.meta}`}>以上为业主预算，实际报价待服务方确认。</p>
              </article>
              {demand.status === "published" ? (
                <QuoteForm key={demand.id} demandId={demand.id} />
              ) : (
                <div className={C.card} role="status">
                  <h2 className={C.sectionTitle}>当前需求仅供查看</h2>
                  <p className="text-ink-2">该需求已建立接单关系，不再提供报价表单。接单关系不代表签署法律合同、付款或施工验收；本页不提供履约状态修改。</p>
                  <Link href="/provider/orders" prefetch={false} className={`${C.btnBase} ${C.btnSecondary} ${C.btnSm}`}>返回我的接单</Link>
                </div>
              )}
            </>
          ) : (
            <div className={C.card} role="status" aria-live="polite">
              <h2 className={C.sectionTitle}>当前需求暂不可报价</h2>
              <p className="!mb-0 text-ink-2">该需求当前不是已发布状态，本入口不展示详情或报价表单。请返回需求大厅或稍后刷新。</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function DemandDetail({ demandId }: { demandId: string }) {
  const [state, setState] = useState<DemandDetailState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    loadDemandDetail(demandId).then(
      (response) => {
        if (active) setState({ status: "ready", response });
      },
      (error: unknown) => {
        if (active) setState(demandDetailFailureState(error));
      },
    );
    return () => { active = false; };
  }, [demandId, reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey((key) => key + 1);
  }

  return <DemandDetailContent demandId={demandId} state={state} onReload={reload} />;
}
