"use client";

import Link from "next/link";
import { useState } from "react";
import { Explainer } from "@/components/ui";
import { Badge, Button, C, Card, Empty, LinkButton, Note, PageHeader, SectionHead } from "./ui";
import { demandHref, formatYuan, projectHref } from "./demand-list";
import {
  confirmDemoPayment,
  detectPaymentIssues,
  paymentSummary,
  toPaymentNodes,
  type PaymentNode,
} from "./payments";
import { usePayments, type PaymentsState } from "./usePayments";
import { ApiClientError } from "@/lib/api-client";

export function paymentConfirmationMessage(stage: string, amountCents: number): string {
  return `确认演示付款节点「${stage}」（${formatYuan(amountCents)}）吗？此操作只改变演示状态，确认后不能撤销，也不代表真实付款。`;
}

export function requestPaymentConfirmation(
  confirm: (message: string) => boolean,
  stage: string,
  amountCents: number,
): boolean {
  return confirm(paymentConfirmationMessage(stage, amountCents));
}

/**
 * 业主端「节点付款」页。
 *
 * 定位：让业主在开工前就看到「一共多少钱、按什么节点付、每笔占多少」，
 * 这是「预结算透明、不玩增项」的可见部分。
 *
 * 边界：不接真实支付、不做资金托管，所有节点都带 simulated 标记；
 * 页面不会出现「已支付」这种没有接口支撑的字样。
 */
export function PaymentsPanel({ id }: { id: string }) {
  const { reload, ...state } = usePayments();
  return <PaymentsContent key={id} id={id} state={state} reload={reload} />;
}

export function PaymentsContent({ id, state, reload }: {
  id: string;
  state: PaymentsState;
  reload: () => void;
}) {
  const { phase, items, source, error } = state;
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleConfirm = async (node: PaymentNode) => {
    if (
      typeof window !== "undefined"
      && !requestPaymentConfirmation(window.confirm.bind(window), node.stage, node.amountCents)
    ) {
      return;
    }
    const paymentId = node.id;
    setConfirmingId(paymentId);
    setActionNote(null);
    try {
      const result = await confirmDemoPayment(paymentId);
      setActionNote(`演示确认已返回：${result.data.stage}，来源：${result.source}。这不代表真实付款。`);
      await reload();
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status === 409) {
        setActionNote(`该演示节点无法重复确认：${cause.message}`);
      } else {
        setActionNote(cause instanceof Error ? cause.message : "演示确认失败，请重试。");
      }
    } finally {
      setConfirmingId(null);
    }
  };

  if (phase === "loading") {
    return (
      <div>
        <PageHeader title="节点付款" subtitle={`正在读取需求 ${id} 的付款计划…`} />
        <p className={C.meta} role="status">正在加载，模拟记录会单独标注。</p>
        <Card className="animate-pulse">
          <div className="mb-4 h-4 w-1/3 rounded bg-mist" />
          <div className="grid gap-3">
            {[0, 1].map((row) => (
              <div key={row} className="h-16 w-full rounded bg-canvas" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div>
        <PageHeader title="节点付款" subtitle="读取付款计划失败" />
        <Note tone="danger" title="接口请求失败">
          <p>{error}</p>
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              重新加载
            </Button>
          </div>
        </Note>
      </div>
    );
  }

  if (items.some((item) => item.demandId !== id)) {
    return (
      <div>
        <PageHeader title="节点付款" subtitle={`未取得需求 ${id} 的付款计划`} />
        <Note tone="warn" title="返回付款节点与当前需求不一致">
          <p>接口返回了不属于当前需求的付款节点，本页已停止展示整份付款计划。</p>
          <p>请重试或返回需求详情。</p>
        </Note>
        <p className={C.meta}>接口来源：{source ?? "未确认"}{source === "mock" ? "（模拟数据）" : ""}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={reload}>重新加载</Button>
          <LinkButton href={demandHref(id)} size="sm" variant="secondary">返回需求详情</LinkButton>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        <PageHeader title="节点付款" subtitle="未取得付款节点" />
        <p className={C.meta}>接口来源：{source ?? "未确认"}{source === "mock" ? "（模拟数据）" : ""}</p>
        <Empty
          title="接口没有返回付款节点"
          hint="暂未取得付款计划，请重试。"
          action={
            <LinkButton href={demandHref(id)} size="sm" variant="secondary">返回需求详情</LinkButton>
          }
        />
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={reload}>重新加载</Button>
        </div>
      </div>
    );
  }

  const summary = paymentSummary(items);
  const nodes = toPaymentNodes(items);
  const issues = detectPaymentIssues(items);
  const allSimulated = items.every((item) => item.simulated);

  return (
    <div>
      <div className="mb-3">
        <Link href={projectHref(id)} className="text-[14px] font-medium text-brand">
          ← 返回施工进度
        </Link>
      </div>

      <PageHeader
        title="节点付款"
        subtitle={`需求 ${id}，${summary.count} 个节点，数据来源 ${source ?? "未知"}`}
        aside={allSimulated ? <Badge tone="accent">全部为模拟数据</Badge> : null}
      />

      <p className={C.meta}>接口来源：{source ?? "未确认"}；付款节点均为模拟节点，不代表实际付款。</p>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "计划付款总额", value: formatYuan(summary.totalCents), hint: "各节点金额之和" },
          {
            label: "已确认金额",
            value: formatYuan(summary.confirmedCents),
            hint: `${summary.confirmedCount} 个节点（演示确认）`,
          },
          {
            label: "待确认金额",
            value: formatYuan(summary.pendingCents),
            hint: `${summary.pendingCount} 个节点`,
          },
          {
            label: "确认进度",
            value: `${summary.confirmedPercent}%`,
            hint: "已确认金额 / 计划总额",
          },
        ].map((item) => (
          <Card key={item.label} className="!p-4">
            <div className={C.meta}>{item.label}</div>
            <div className="num mt-1 text-[22px] font-bold leading-tight text-ink">
              {item.value}
            </div>
            <div className="mt-0.5 truncate text-[13px] text-ink-3" title={item.hint}>
              {item.hint}
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card>
          <SectionHead
            title="付款节点"
            aside={<span className={C.meta}>按接口返回顺序</span>}
          />
          <ol className="relative grid gap-3 pl-6">
            <span className="absolute bottom-3 left-[7px] top-3 w-px bg-line" aria-hidden />
            {nodes.map((node) => (
              <li key={node.id} className="relative">
                <span
                  className={`absolute -left-6 top-3 h-[15px] w-[15px] rounded-full border-2 border-white ${
                    node.tone === "brand" ? "bg-brand" : "bg-wood"
                  }`}
                  aria-hidden
                />
                <div className="rounded-control border border-line bg-canvas/50 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[15px] font-medium text-ink">
                      <span className="num mr-2 text-[13px] font-normal text-ink-3">节点 {node.index}</span>
                      {node.stage}
                    </span>
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      <Badge tone={node.tone}>{node.statusLabel}</Badge>
                      {node.status === "pending" ? (
                        <Button
                          size="sm"
                          onClick={() => void handleConfirm(node)}
                          disabled={confirmingId !== null}
                        >
                          {confirmingId === node.id ? "确认中…" : "确认本节点"}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
                    <span className="num text-[18px] font-semibold text-ink">
                      {formatYuan(node.amountCents)}
                    </span>
                    <span className="num text-[13px] text-ink-3">
                      占总额 {node.sharePercent}%
                      {node.simulated ? "，模拟节点" : ""}
                    </span>
                  </div>
                  <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-mist">
                    <div
                      className="h-full rounded-full bg-brand/70"
                      style={{ width: `${Math.min(100, node.sharePercent)}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <div className="grid content-start gap-4">
          <Card>
            <SectionHead
              title="付款计划自检"
              aside={
                <Badge tone={issues.length > 0 ? "danger" : "brand"}>
                  {issues.length > 0 ? `${issues.length} 个问题` : "通过"}
                </Badge>
              }
            />
            {issues.length === 0 ? (
              <Note tone="ok">
                <p className="!mb-0">
                  节点名称不重复、金额有效、未混入其他需求 —— 业主能逐条对上「哪一步付多少」。
                </p>
              </Note>
            ) : (
              <ul className="grid gap-2">
                {issues.map((issue) => (
                  <li key={issue.code}>
                    <Note tone="warn">
                      <p className="!mb-0">{issue.message}</p>
                    </Note>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <SectionHead title="操作" />
            <p className={`!mb-3 ${C.meta}`}>
              确认本节点前会弹出二次确认；确认后调用 POST /api/payment，只改变内存中的演示状态；不代表真实付款或资金托管。
              上传凭证仍需文件存储与独立接口支持。
            </p>
            <div className="grid gap-2">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() =>
                  setActionNote(
                    "上传凭证需要文件存储与 POST /api/payment，均未实现；字段缺口已写进 docs/requests/A-schedule-payment.md。",
                  )
                }
              >
                上传付款凭证
              </Button>
            </div>
            {actionNote ? (
              <div className="mt-3">
                <Note tone="info">{actionNote}</Note>
              </div>
            ) : null}
          </Card>

          <Explainer summary="模拟付款，不扣款" className="!my-0">
            <p>
              本页不接支付通道、不做资金托管，所有节点 <code>simulated</code> 均为 true。
              真实上线前必须接入持牌资金托管账户，且「已确认」只代表业主看过单据，不代表平台代收款项。
            </p>
          </Explainer>
        </div>
      </div>
    </div>
  );
}
