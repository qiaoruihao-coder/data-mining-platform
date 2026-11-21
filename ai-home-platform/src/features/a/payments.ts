/**
 * 节点付款的纯逻辑：金额汇总、节点占比、状态文案、数据自检。
 *
 * 契约里 Payment 只有 stage / amountCents / status / simulated 四个字段，
 * 没有到期日、支付方式、凭证 —— 所以本页只做「计划与状态展示」，
 * 不会伪造「已付款」「资金已托管」这类结论。
 */
import { Payment, PaymentActionInput } from "@/contracts";
import type { PaymentDTO as PaymentDTOContract, SourceDTO } from "@/contracts";
import { apiPost } from "@/lib/api-client";

export type PaymentDTO = PaymentDTOContract;
export type PaymentStatus = PaymentDTO["status"];
export type Tone = "brand" | "accent" | "neutral" | "danger";

export type PaymentActionResponse = {
  data: PaymentDTO;
  source: SourceDTO;
};

/** 只提交 D 已冻结的演示确认动作，不把它描述成真实支付。 */
export function confirmDemoPayment(paymentId: string): Promise<PaymentActionResponse> {
  const input = PaymentActionInput.parse({ paymentId, action: "confirm_demo" });
  return apiPost("/api/payment", input, Payment);
}

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  pending: { label: "待确认", tone: "accent" },
  confirmed_demo: { label: "已确认（演示）", tone: "brand" },
};

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS[status]?.label ?? status;
}

export function paymentStatusTone(status: PaymentStatus): Tone {
  return PAYMENT_STATUS[status]?.tone ?? "neutral";
}

export type PaymentSummary = {
  count: number;
  totalCents: number;
  confirmedCents: number;
  pendingCents: number;
  confirmedCount: number;
  pendingCount: number;
  /** 已确认金额占比（0–100，取整） */
  confirmedPercent: number;
};

export function paymentSummary(list: PaymentDTO[]): PaymentSummary {
  const totalCents = list.reduce((sum, item) => sum + Math.max(0, item.amountCents), 0);
  const confirmedCents = list
    .filter((item) => item.status === "confirmed_demo")
    .reduce((sum, item) => sum + Math.max(0, item.amountCents), 0);
  const pendingCents = totalCents - confirmedCents;
  return {
    count: list.length,
    totalCents,
    confirmedCents,
    pendingCents,
    confirmedCount: list.filter((item) => item.status === "confirmed_demo").length,
    pendingCount: list.filter((item) => item.status === "pending").length,
    confirmedPercent: totalCents > 0 ? Math.round((confirmedCents / totalCents) * 100) : 0,
  };
}

/** 单个节点占合同总额的比例，取一位小数；总额为 0 时返回 0，不产生 NaN */
export function sharePercent(amountCents: number, totalCents: number): number {
  if (totalCents <= 0) return 0;
  const percent = (Math.max(0, amountCents) / totalCents) * 100;
  return Math.round(percent * 10) / 10;
}

export type PaymentIssue = { code: "no-items" | "duplicate-stage" | "zero-amount" | "mixed-demand"; message: string };

/**
 * 付款数据自检：节点缺失、节点重名（业主分不清付的是哪一笔）、金额为 0、混入别的需求。
 * 这些都会让「预结算透明」变成一句空话，所以在页面上直接暴露出来，而不是吞掉。
 */
export function detectPaymentIssues(list: PaymentDTO[]): PaymentIssue[] {
  if (list.length === 0) {
    return [{ code: "no-items", message: "接口没有返回任何付款节点，无法展示付款计划。" }];
  }

  const issues: PaymentIssue[] = [];
  const seen = new Map<string, number>();
  for (const item of list) {
    seen.set(item.stage, (seen.get(item.stage) ?? 0) + 1);
  }
  for (const [stage, count] of seen) {
    if (count > 1) {
      issues.push({
        code: "duplicate-stage",
        message: `节点名称「${stage}」出现了 ${count} 次，业主无法区分这几笔付款。`,
      });
    }
  }

  const zero = list.filter((item) => item.amountCents <= 0);
  if (zero.length > 0) {
    issues.push({
      code: "zero-amount",
      message: `有 ${zero.length} 个节点金额为 0：${zero.map((item) => item.stage).join("、")}。`,
    });
  }

  const demandIds = new Set(list.map((item) => item.demandId));
  if (demandIds.size > 1) {
    issues.push({
      code: "mixed-demand",
      message: `返回的节点属于 ${demandIds.size} 个不同需求（${[...demandIds].join("、")}），不能混在一起展示。`,
    });
  }

  return issues;
}

export type PaymentNode = {
  id: string;
  index: number;
  stage: string;
  amountCents: number;
  status: PaymentStatus;
  statusLabel: string;
  tone: Tone;
  sharePercent: number;
  simulated: boolean;
};

/** 转成时间线需要的展示节点，序号按接口返回顺序（接口没有到期日，排序依据只能是这个） */
export function toPaymentNodes(list: PaymentDTO[]): PaymentNode[] {
  const total = list.reduce((sum, item) => sum + Math.max(0, item.amountCents), 0);
  return list.map((item, index) => ({
    id: item.id,
    index: index + 1,
    stage: item.stage,
    amountCents: item.amountCents,
    status: item.status,
    statusLabel: paymentStatusLabel(item.status),
    tone: paymentStatusTone(item.status),
    sharePercent: sharePercent(item.amountCents, total),
    simulated: item.simulated,
  }));
}
