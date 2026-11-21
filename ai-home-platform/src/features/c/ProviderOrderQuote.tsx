"use client";

import React, { useEffect, useId, useState } from "react";
import type { OrderSummaryDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C } from "@/components/ui";
import { ProviderQuoteDetails } from "./ProviderQuoteDetails";
import { QuoteSource } from "./QuoteSource";
import { formatQuoteMoney } from "./quote-form";
import { loadProviderOrderQuote, providerOrderQuoteErrorMessage, type ProviderOrderQuoteState } from "./provider-order-quote";

export function ProviderOrderQuoteContent({ state, onReload }: {
  state: ProviderOrderQuoteState;
  onReload: () => void;
}) {
  const response = state.status === "ready" ? state.response : null;
  const quote = response?.quote;
  const hasPending = quote && (quote.pendingItems.length > 0 || quote.items.some(item => item.unitPriceCents === null || item.amountCents === null));
  return (
    <div className="mt-4 min-w-0 space-y-4 rounded-card border border-line bg-canvas/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className={`!mb-0 ${C.sectionTitle}`}>接单关联报价</h3>
        <Button size="sm" variant="secondary" onClick={onReload} disabled={state.status === "loading"}>
          {state.status === "loading" ? "正在读取报价…" : state.status === "error" ? "重新加载关联报价" : "刷新关联报价"}
        </Button>
      </div>
      {state.status === "loading" && <p className="!mb-0" role="status">正在验证服务方会话并读取关联报价…</p>}
      {state.status === "error" && <div role="alert"><p className="font-medium">暂时无法核对关联报价</p><p className="!mb-0">{state.message}</p></div>}
      {response && quote && (
        <>
          <div className="flex flex-wrap gap-2" role="status">
            <StatusBadge label={response.source === "mock" ? "关联报价查询来源：模拟标识（mock）" : "关联报价查询来源：已保存记录"} />
            <QuoteSource source={quote.source} />
            <StatusBadge label="报价已接受" />
          </div>
          <p className={`!mb-0 ${C.meta}`}>以下报价与本条接单的报价、需求和服务方编号一致。演示身份查询仍为 mock；来源标识不代表付款、开工或施工验收。</p>
          <dl className="num m-0 grid gap-4 text-sm sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-[13px] text-ink-3">关联报价编号</dt><dd className="m-0 mt-1 break-all">{quote.id}</dd></div>
            <div><dt className="text-[13px] text-ink-3">已知费用小计</dt><dd className="m-0 mt-1 font-medium">{formatQuoteMoney(quote.knownTotalCents)}</dd></div>
            <div><dt className="text-[13px] text-ink-3">报价预计工期</dt><dd className="m-0 mt-1">{quote.estimatedDays} 天</dd></div>
            <div><dt className="text-[13px] text-ink-3">待确认费用</dt><dd className="m-0 mt-1">{hasPending ? "有，完整总价未确定" : quote.items.length === 0 ? "未提供明细，无法确认" : "暂无"}</dd></div>
          </dl>
          <p className={`!mb-0 ${C.meta}`}>已知小计不代表最终总价；未知费用不按零计算，报价预计工期不代表实际排期。收起后再次查看会重新读取；登录或身份变化后请刷新接单。</p>
          <ProviderQuoteDetails quote={quote} />
        </>
      )}
    </div>
  );
}

function ProviderOrderQuoteLoader({ order }: { order: OrderSummaryDTO }) {
  const [state, setState] = useState<ProviderOrderQuoteState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    loadProviderOrderQuote(order).then(
      response => { if (active) setState({ status: "ready", response }); },
      error => { if (active) setState({ status: "error", message: providerOrderQuoteErrorMessage(error) }); },
    );
    return () => { active = false; };
  }, [order, reloadKey]);
  function reload() {
    setState({ status: "loading" });
    setReloadKey(previous => previous + 1);
  }
  return <ProviderOrderQuoteContent state={state} onReload={reload} />;
}

export function ProviderOrderQuote({ order }: { order: OrderSummaryDTO }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-4 min-w-0">
      <button type="button" aria-expanded={expanded} aria-controls={panelId}
        className={`${C.btnBase} ${C.btnSecondary}`}
        onClick={() => setExpanded(previous => !previous)}>
        {expanded ? "收起关联报价" : "查看已接受报价"}
        <span className="sr-only">，接单编号：{order.id}</span>
      </button>
      <div id={panelId}>
        {expanded && <ProviderOrderQuoteLoader key={JSON.stringify(order)} order={order} />}
      </div>
    </div>
  );
}
