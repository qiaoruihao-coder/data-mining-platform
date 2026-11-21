"use client";

import { useState } from "react";
import type { OrderSummaryDTO, ScheduleDTO, SourceDTO } from "@/contracts";
import { FulfillmentRuler } from "@/components/ui";
import { Badge, Button, C, Card, Note, SectionHead } from "./ui";
import {
  availableProgressActions,
  orderProgressErrorMessage,
  submitOrderProgress,
  type ProgressActionCandidate,
} from "./order-progress";

const orderStatusLabel: Record<OrderSummaryDTO["status"], string> = {
  contracted: "已签约",
  in_progress: "施工中",
  completed: "已完工",
};

export function OrderProgressPanel({
  demandId,
  order,
  orderPhase = order ? "ready" : "loading",
  orderError = null,
  orderSource = null,
  schedule,
  source,
  reload,
  reloadOrder,
  stampFrom = null,
}: {
  demandId: string;
  order: OrderSummaryDTO | null;
  orderPhase?: "loading" | "ready" | "failed";
  orderError?: string | null;
  orderSource?: SourceDTO | null;
  schedule: ScheduleDTO | null;
  source: SourceDTO | null;
  reload: () => void;
  reloadOrder?: () => void;
  /** 刚确认完成的第一个节点下标；仅这些节点播放盖章动画。 */
  stampFrom?: number | null;
}) {
  const [pending, setPending] = useState<ProgressActionCandidate | null>(null);
  const [phase, setPhase] = useState<"idle" | "submitting" | "success" | "failed">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [responseSource, setResponseSource] = useState<SourceDTO | null>(null);

  if (orderPhase === "loading") {
    return (
      <Card className="mt-4">
        <SectionHead title="履约推进" aside={<Badge tone="neutral">正在读取接单</Badge>} />
        <Note tone="info">正在读取本人接单信息；确认开工和工序操作会在拿到实际订单编号后开放。</Note>
      </Card>
    );
  }

  if (orderPhase === "failed") {
    return (
      <Card className="mt-4">
        <SectionHead title="履约推进" aside={<Badge tone="danger">接单读取失败</Badge>} />
        <Note tone="danger" title="无法确认当前接单">
          <p>{orderError ?? "接单信息加载失败，请重新加载核实。"}</p>
          {reloadOrder ? <Button variant="secondary" size="sm" onClick={reloadOrder}>重新加载接单</Button> : null}
        </Note>
      </Card>
    );
  }

  if (!order) {
    return (
      <Card className="mt-4">
        <SectionHead title="履约推进" aside={<Badge tone="neutral">尚无接单</Badge>} />
        <Note tone="info">
          <p>暂无订单，请先确认报价。</p>
          <p className="mt-2">排期来源：{source ?? "未确认"}；接单来源：{orderSource ?? "未确认"}。</p>
        </Note>
      </Card>
    );
  }

  const actions = availableProgressActions(order, schedule);
  const confirm = async () => {
    if (!pending || phase === "submitting") return;
    setPhase("submitting");
    setMessage(null);
    try {
      const result = await submitOrderProgress(demandId, order.id, schedule, pending);
      setResponseSource(result.source);
      setPending(null);
      setPhase("success");
      setMessage("操作已保存，正在重新读取需求和排期。");
      reload();
    } catch (cause) {
      setPhase("failed");
      setMessage(orderProgressErrorMessage(cause));
    }
  };

  return (
    <Card className="mt-4">
      <SectionHead title="履约推进" aside={<Badge tone={order.source === "mock" ? "accent" : "brand"}>接单来源：{order.source}</Badge>} />
      <p className={`mb-3 ${C.meta}`}>订单 {order.id}，当前状态 {orderStatusLabel[order.status]}，排期版本 {schedule?.version ?? "无"}</p>
      <div className="mb-5">
        <FulfillmentRuler status={order.status} animateFrom={stampFrom} />
      </div>
      {actions.length === 0 ? (
        <Note tone="info">当前没有满足前置条件的履约动作。工序完成只表示业主确认当前工序完成，不等于专业验收或付款完成。</Note>
      ) : (
        <div className="grid gap-2">
          {actions.map((action) => (
            <div key={`${action.action}-${action.taskId ?? "order"}`} className="rounded-control border border-line p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[15px] font-medium text-ink">{action.label}</span>
                <Button variant="secondary" size="sm" disabled={phase === "submitting"} onClick={() => { setPending(action); setPhase("idle"); setMessage(null); }}>
                  先查看确认
                </Button>
              </div>
              <p className={`mt-1 !mb-0 ${C.meta}`}>{action.description}</p>
              {pending?.action === action.action && pending.taskId === action.taskId ? (
                <div className="mt-3 rounded-control bg-warn-soft p-3">
                  <p className="!mb-2 text-[14px] text-warn">请再次确认：{action.label}？确认后才会发送请求。</p>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={phase === "submitting"} onClick={() => void confirm()}>{phase === "submitting" ? "提交中…" : "确认并发送"}</Button>
                    <Button variant="ghost" disabled={phase === "submitting"} onClick={() => setPending(null)}>取消</Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {message ? <div className="mt-3"><Note tone={phase === "failed" ? "danger" : "info"} title={phase === "failed" ? "履约推进未确认" : undefined}><p>{message}</p>{responseSource ? <p className="mt-1">接口来源：{responseSource}。</p> : null}{phase === "failed" ? <Button variant="secondary" size="sm" onClick={reload}>重新加载核实</Button> : null}</Note></div> : null}
      <p className={`mt-3 !mb-0 ${C.meta}`}>每次操作均使用当前排期版本；排期变化或结果不确定时不会自动重发。</p>
    </Card>
  );
}
