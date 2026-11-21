"use client";

import * as React from "react";
import type { QuoteDTO } from "@/contracts";
import type { QuoteComparisonData } from "@/features/b/accept-quote";
import { acceptedOrderErrorMessage, loadAcceptedOrder } from "@/features/b/load-accepted-order";

type VerificationState =
  | { status: "waiting" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: Awaited<ReturnType<typeof loadAcceptedOrder>> };

export function QuoteOrderVerificationContent({ state, selectedQuoteId }: { state: VerificationState; selectedQuoteId: string }) {
  if (state.status === "waiting") return <p>实际接单关系待核实：请先完成需求和报价刷新。</p>;
  if (state.status === "loading") return <p>正在只读查询实际接单关系…</p>;
  if (state.status === "error") return <p role="alert">{state.message}</p>;
  if (state.status !== "ready") return null;
  const { data: order, meta } = state.result;
  if (order === null) return <p>本次只读查询：尚无实际接单关系；查询来源：{meta.source}。这仅代表本次读取结果；报价标为已接受也不会自动补造接单。</p>;
  return <div className="rounded-control border border-line bg-canvas p-4 text-[15px]">
    <p>{order.acceptedQuoteId === selectedQuoteId ? "只读核实成功：所选报价已有实际接单关系。" : "只读核实：已接受其他报价，不能改选。"}</p>
    <p className="break-all">接单编号：{order.id}；报价编号：{order.acceptedQuoteId}；服务方：{order.providerId}</p>
    <p>接单状态：{({ contracted: "已签约", in_progress: "施工中", completed: "已完成" } as const)[order.status]}；接单及查询来源：{order.source}{order.source === "mock" ? "（模拟来源，不代表生产服务方认证）" : "（已保存数据）"}。</p>
    <p className="mb-0">接单关系不代表最终价格、付款、法律合同或专业验收结论。</p>
  </div>;
}

export function QuoteOrderVerification({ data, selectedQuote }: { data: QuoteComparisonData | null; selectedQuote: QuoteDTO }) {
  const [read, setRead] = React.useState<{ comparison: QuoteComparisonData; state: VerificationState } | null>(null);
  React.useEffect(() => {
    if (!data) return;
    let active = true;
    void loadAcceptedOrder(data).then(
      result => { if (active) setRead({ comparison: data, state: { status: "ready", result } }); },
      error => { if (active) setRead({ comparison: data, state: { status: "error", message: acceptedOrderErrorMessage(error) } }); },
    );
    return () => { active = false; };
  }, [data]);
  // 新一轮报价读取开始就隐藏旧接单；迟到结果不能覆盖更新的报价快照。
  const state: VerificationState = !data ? { status: "waiting" }
    : read?.comparison === data ? read.state : { status: "loading" };
  return <QuoteOrderVerificationContent state={state} selectedQuoteId={selectedQuote.id} />;
}
