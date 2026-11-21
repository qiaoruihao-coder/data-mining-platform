"use client";

import Link from "next/link";
import { Explainer } from "@/components/ui";
import { Badge, Button, C, Card, Empty, LinkButton, Note, PageHeader, SectionHead } from "./ui";
import {
  demandTitle,
  formatBudget,
  isPostContract,
  paymentsHref,
  projectHref,
  statusLabel,
  statusTone,
} from "./demand-list";
import type { DemandDetailState } from "./demand-detail";
import { itemSourceBadge, itemSource } from "./demand-source";
import { renovationLabel } from "./demand-chat";
import { useDemandDetail } from "./useDemandDetail";
import { DemandEditPanel } from "./DemandEditPanel";
import { TicketCreatePanel } from "./TicketCreatePanel";
import { ReviewPanel } from "./ReviewPanel";

/** 需求详情仅展示按 ID 接口确认的数据。 */
export function DemandDetailPanel({ id }: { id: string }) {
  const { state, reload } = useDemandDetail(id);
  return <DemandDetailContent id={id} state={state} reload={reload} />;
}

export function DemandDetailContent({ id, state, reload }: {
  id: string;
  state: DemandDetailState;
  reload: () => void;
}) {
  if (state.phase === "loading") {
    return (
      <div>
        <PageHeader title="需求详情" subtitle={`正在读取需求 ${id}…`} />
        <p className={C.meta} role="status">正在加载，模拟记录会单独标注。</p>
        <Card className="animate-pulse">
          <div className="mb-3 h-4 w-1/2 rounded bg-mist" />
          <div className="mb-2 h-3 w-full rounded bg-canvas" />
          <div className="h-3 w-3/4 rounded bg-canvas" />
        </Card>
      </div>
    );
  }

  if (state.phase === "failed") {
    return (
      <div>
        <PageHeader title="需求详情" subtitle="读取需求失败" />
        <Note tone="danger" title="接口请求失败">
          <p>{state.error}</p>
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              重新加载
            </Button>
          </div>
        </Note>
      </div>
    );
  }

  if (state.phase === "missing") {
    return (
      <div>
        <PageHeader title="需求详情" subtitle="没有找到这条需求" />
        <Empty
          title={`接口未返回需求「${id}」`}
          hint="这条需求不存在或已被删除，请核对需求链接。"
          action={
            <LinkButton href="/owner" size="sm" variant="secondary">返回需求列表</LinkButton>
          }
        />
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={reload}>重新读取</Button>
        </div>
      </div>
    );
  }

  const { demand } = state;
  const demandSource = itemSource(demand);
  const demandSourceBadge = itemSourceBadge(demand);

  return (
    <div>
      <div className="mb-3">
        <Link href="/owner" className="text-[14px] font-medium text-brand">
          ← 返回需求列表
        </Link>
      </div>

      <PageHeader
        title={demandTitle(demand)}
        subtitle={`需求编号 ${demand.id}，逐条来源 ${demandSource ?? "未确认"}`}
        aside={
          <span className="flex items-center gap-2">
            {demandSourceBadge ? <Badge tone="accent">{demandSourceBadge}</Badge> : null}
            <Badge tone={statusTone(demand.status)}>{statusLabel(demand.status)}</Badge>
          </span>
        }
      />

      <p className={C.meta}>
        {demandSource === "mock"
          ? "模拟需求，仅供演示。"
          : demandSource === "live"
            ? "需求已保存。"
            : "需求来源待确认。"}
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <SectionHead title="需求描述" />
          <p className="!mb-0 max-w-[38em] text-[16px] leading-relaxed text-ink">{demand.description}</p>

          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-line pt-5">
            {[
              ["城市", demand.city],
              ["面积", `${demand.areaM2} ㎡`],
              ["改造类型", renovationLabel(demand.renovationType)],
              ["期望工期", `${demand.desiredDays} 天`],
              ["预算区间", formatBudget(demand.budgetMinCents, demand.budgetMaxCents)],
              ["当前状态", statusLabel(demand.status)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className={C.meta}>{label}</div>
                <div className="num text-[16px] font-semibold text-ink">{value}</div>
              </div>
            ))}
          </div>
        </Card>

        <div className="grid content-start gap-4">
          <DemandEditPanel demand={demand} onChanged={() => void reload()} />
          {demand.source === "live" && demand.status !== "draft" ? <TicketCreatePanel demand={demand} /> : null}
          {demand.source === "live" && demand.status !== "draft" ? <ReviewPanel demand={demand} /> : null}
          <Card>
            <SectionHead title="下一步" aside={<Badge tone="accent">推荐</Badge>} />
            <p className={`!mb-3 ${C.meta}`}>
              查看这条需求的服务方匹配与报价信息。
            </p>
            <div className="grid gap-2">
              <LinkButton href={`/owner/matches/${encodeURIComponent(demand.id)}`} className="w-full">匹配服务方</LinkButton>
              <LinkButton href={`/owner/quotes/${encodeURIComponent(demand.id)}`} variant="secondary" className="w-full">查看报价对比</LinkButton>
              <LinkButton href="/owner/demand/chat" variant="ghost" className="w-full">创建另一条需求</LinkButton>
            </div>
          </Card>

          <Card>
            <SectionHead
              title="施工与资金"
              aside={<Badge tone={isPostContract(demand.status) ? "brand" : "neutral"}>签约后</Badge>}
            />
            <p className={`!mb-3 ${C.meta}`}>
              排期由签约后的施工方提交，付款按节点走；两页都只读接口数据，不做本地假状态。
            </p>
            <div className="grid gap-2">
              <LinkButton href={projectHref(demand.id)} variant={isPostContract(demand.status) ? "primary" : "secondary"} className="w-full">查看施工进度</LinkButton>
              <LinkButton href={paymentsHref(demand.id)} variant="secondary" className="w-full">查看节点付款</LinkButton>
            </div>
            {!isPostContract(demand.status) ? (
              <div className="mt-3">
                <Note tone="info">
                  需求处于「{statusLabel(demand.status)}」阶段，签约后可安排排期和付款节点。
                </Note>
              </div>
            ) : null}
          </Card>

          <Explainer summary="数据说明" className="!my-0">
            <p>
              需求有变更时，点击重新加载查看。
            </p>
            <Button variant="secondary" size="sm" onClick={reload}>重新加载</Button>
          </Explainer>
        </div>
      </div>
    </div>
  );
}
