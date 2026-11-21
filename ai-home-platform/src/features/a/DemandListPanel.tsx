"use client";

import { useState } from "react";
import { Explainer, FulfillmentRuler } from "@/components/ui";
import { Badge, Button, C, Card, Empty, Field, LinkButton, Note, PageHeader } from "./ui";
import {
  STAGES,
  demandHref,
  demandTitle,
  formatBudget,
  filterDemands,
  isPostContract,
  paymentsHref,
  projectHref,
  statusLabel,
  statusTone,
  type DemandStatusFilter,
} from "./demand-list";
import { itemSourceBadge, listSourceNote } from "./demand-source";
import { useDemandList, type DemandListState } from "./useDemandList";

/** 加载骨架：让「正在取数据」和「没有数据」在视觉上区分开 */
function SkeletonCard() {
  return (
    <div className={`${C.card} animate-pulse`}>
      <div className="mb-3 h-4 w-2/3 rounded bg-mist" />
      <div className="mb-2 h-3 w-full rounded bg-canvas" />
      <div className="h-3 w-4/5 rounded bg-canvas" />
      <div className="mt-4 h-3 w-1/2 rounded bg-mist" />
    </div>
  );
}

export function DemandListPanel() {
  const { reload, ...state } = useDemandList();
  return <DemandListContent state={state} reload={reload} />;
}

export function DemandListContent({ state, reload }: { state: DemandListState; reload: () => void }) {
  const { phase, items, source, error } = state;
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<DemandStatusFilter>("all");
  const filteredItems = filterDemands(items, keyword, status);
  const clearFilters = () => {
    setKeyword("");
    setStatus("all");
  };

  return (
    <div>
      <PageHeader
        title="需求列表"
        subtitle="登录后查看我的需求。"
        aside={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={reload} disabled={phase === "loading"}>
              {phase === "loading" ? "刷新中…" : "刷新列表"}
            </Button>
            <LinkButton href="/owner/demand/chat">发起新需求</LinkButton>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={source === "live" ? "brand" : source === "mock" ? "accent" : "neutral"}>
          列表接口来源：{source ?? "未确认"}
        </Badge>
        <span className={C.meta}>
          {phase === "ready" ? `${items.length} 条需求` : phase === "loading" ? "加载中" : "加载失败"}
        </span>
      </div>

      {phase === "ready" && (
        <Explainer summary="数据来源" className="!mt-0">
          <p>{listSourceNote(source)}</p>
        </Explainer>
      )}

      {phase === "loading" && (
        <>
          <p className={C.meta} role="status">正在加载，模拟记录会单独标注。</p>
          <div className="grid gap-3 md:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </>
      )}

      {phase === "failed" && (
        <Note tone="danger" title="需求列表加载失败">
          <p>{error}</p>
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              重新加载
            </Button>
          </div>
        </Note>
      )}

      {phase === "ready" && items.length === 0 && (
        <Empty
          title="还没有需求单"
          hint="填写并提交改造需求。"
          action={
            <LinkButton href="/owner/demand/chat" size="sm">去发起需求</LinkButton>
          }
        />
      )}

      {phase === "ready" && items.length > 0 && (
        <>
          <div role="group" aria-label="需求阶段" className="mb-5 flex flex-wrap gap-2">
            {[{status:"all" as const,label:"全部"},...STAGES.map(stage=>({status:stage.status,label:stage.status==="completed"?"已完成":statusLabel(stage.status)}))].map(stage=>{
              const count=filterDemands(items,keyword,stage.status).length;
              const selected=status===stage.status;
              return <button key={stage.status} type="button" aria-pressed={selected} onClick={()=>setStatus(stage.status)} className={`inline-flex min-h-[44px] items-center gap-2 rounded-control border px-4 py-2 text-[15px] font-medium transition-colors ${selected?"border-[#F2C84B] bg-[#F2C84B] text-ink":"border-line bg-white text-ink-2 hover:border-brand hover:text-brand"}`}>
                {stage.label}<span className={`num rounded-full px-2 py-0.5 text-xs ${selected?"bg-white/60":"bg-canvas"}`}>{count}</span>
              </button>;
            })}
          </div>
          <Card className="mb-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="搜索需求">
                <input
                  className={C.input}
                  type="search"
                  placeholder="需求编号、城市或描述"
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                />
              </Field>

              <Button variant="secondary" onClick={clearFilters} disabled={keyword === "" && status === "all"}>清空筛选</Button>
            </div>
            <p className={`!mb-0 mt-3 ${C.meta}`} role="status" aria-live="polite">
              显示 {filteredItems.length} / {items.length} 条需求
            </p>
          </Card>
          {filteredItems.length === 0 ? (
            <Empty
              title="没有符合筛选条件的需求"
              hint="调整条件或清除筛选。"
              action={<Button variant="secondary" size="sm" onClick={clearFilters}>查看全部已加载需求</Button>}
            />
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            {filteredItems.map((demand) => (
              <Card key={demand.id} className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className={`!mb-1 ${C.sectionTitle}`}>{demandTitle(demand)}</h2>
                      {itemSourceBadge(demand) ? <Badge tone="accent">{itemSourceBadge(demand)}</Badge> : null}
                    </div>
                    <p className={`!mb-0 ${C.meta}`}>需求编号：{demand.id}</p>
                  </div>
                  <Badge tone={statusTone(demand.status)}>{statusLabel(demand.status)}</Badge>
                </div>

                <p className="!mb-0 line-clamp-2 text-[15px] leading-relaxed text-ink-2">
                  {demand.description}
                </p>

                <FulfillmentRuler status={demand.status} compact />

                <dl className="num !mb-0 grid grid-cols-3 gap-3">
                  <div>
                    <dt className={C.meta}>预算</dt>
                    <dd className="!mb-0 text-[17px] font-semibold leading-snug text-ink">
                      {formatBudget(demand.budgetMinCents, demand.budgetMaxCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className={C.meta}>期望工期</dt>
                    <dd className="!mb-0 text-[17px] font-semibold leading-snug text-ink">
                      {demand.desiredDays} 天
                    </dd>
                  </div>
                  <div>
                    <dt className={C.meta}>面积</dt>
                    <dd className="!mb-0 text-[17px] font-semibold leading-snug text-ink">
                      {demand.areaM2} ㎡
                    </dd>
                  </div>
                </dl>

                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  <LinkButton href={demandHref(demand.id)} size="sm">查看需求详情</LinkButton>
                  {isPostContract(demand.status) ? (
                    <>
                      <LinkButton href={projectHref(demand.id)} variant="secondary" size="sm">施工进度</LinkButton>
                      <LinkButton href={paymentsHref(demand.id)} variant="ghost" size="sm">节点付款</LinkButton>
                    </>
                  ) : (
                    <>
                      <LinkButton href={`/owner/matches/${encodeURIComponent(demand.id)}`} variant="secondary" size="sm">找服务方</LinkButton>
                      <LinkButton href={`/owner/quotes/${encodeURIComponent(demand.id)}`} variant="ghost" size="sm">看报价</LinkButton>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>

        </>
      )}
    </div>
  );
}
