/**
 * 需求列表/详情的纯逻辑：状态文案、金额格式化、按 ID 查找。
 * 不涉及 React 与网络，便于单测；页面只做展示。
 */
import type { DemandDTO } from "@/contracts";
import { renovationLabel } from "./demand-chat";

export type StatusTone = "brand" | "accent" | "neutral" | "danger";

/** 契约里的 status 是英文枚举，页面上一律显示中文 */
export const STATUS_LABELS: Record<DemandDTO["status"], { label: string; tone: StatusTone }> = {
  draft: { label: "草稿", tone: "neutral" },
  published: { label: "待匹配", tone: "accent" },
  contracted: { label: "已签约", tone: "brand" },
  in_progress: { label: "施工中", tone: "brand" },
  completed: { label: "已完工", tone: "neutral" },
};

export function statusLabel(status: DemandDTO["status"]): string {
  return STATUS_LABELS[status]?.label ?? status;
}

export function statusTone(status: DemandDTO["status"]): StatusTone {
  return STATUS_LABELS[status]?.tone ?? "neutral";
}

/** 分 → 元，保留真实分值；负值、非整数和非有限值一律按 0 处理。 */
export function formatYuan(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) return "¥0";
  return "¥" + (cents / 100).toLocaleString("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  });
}

/** 预算区间：上下限相同就只显示一个数 */
export function formatBudget(minCents: number, maxCents: number): string {
  if (minCents === maxCents) return formatYuan(minCents);
  return `${formatYuan(minCents)} – ${formatYuan(maxCents)}`;
}

/** 列表标题：契约里没有标题字段，用「城市 面积 改造类型」拼，避免出现无名卡片 */
export function demandTitle(demand: DemandDTO): string {
  return `${demand.city} ${demand.areaM2}㎡ ${renovationLabel(demand.renovationType)}`;
}

/** 按 ID 在列表里找需求；找不到返回 null，调用方必须如实提示而不是编数据 */
export function findDemand(list: DemandDTO[], id: string): DemandDTO | null {
  return list.find((item) => item.id === id) ?? null;
}

export type DemandStatusFilter = DemandDTO["status"] | "all";

/** 仅筛选已加载的记录，保留接口顺序及逐条来源，不向接口添加未约定的参数。 */
export function filterDemands(
  items: readonly DemandDTO[],
  keyword: string,
  status: DemandStatusFilter,
): DemandDTO[] {
  const query = keyword.trim().toLowerCase();
  return items.filter((item) =>
    (status === "all" || item.status === status)
    && (!query || [item.id, item.city, item.description].some((value) => value.toLowerCase().includes(query))),
  );
}

/**
 * 一条需求从「说清楚」到「住进去」的五个阶段，顺序与契约 status 一一对应。
 * 列表卡片上用这条链告诉业主「我现在走到哪一步了」，而不是只给一个状态词。
 */
export const STAGES = [
  { status: "draft", label: "需求澄清" },
  { status: "published", label: "匹配报价" },
  { status: "contracted", label: "签约定标" },
  { status: "in_progress", label: "施工中" },
  { status: "completed", label: "已完工" },
] as const satisfies readonly { status: DemandDTO["status"]; label: string }[];

/** 当前处于第几个阶段（0 起）；未知状态返回 0，避免进度条整条变灰 */
export function stageIndex(status: DemandDTO["status"]): number {
  const index = STAGES.findIndex((stage) => stage.status === status);
  return index < 0 ? 0 : index;
}

/** 签约之后才该出现的入口（施工进度、节点付款） */
export function isPostContract(status: DemandDTO["status"]): boolean {
  return status === "contracted" || status === "in_progress" || status === "completed";
}

/**
 * 链接里的需求 ID 一律 encodeURIComponent（与 B/C 的做法一致）。
 * ID 目前是 cuid，但契约只约束非空字符串，未来若允许中文或特殊字符，
 * 不转义会直接生成非法 URL。
 */
export function demandHref(id: string): string {
  return `/owner/demand/${encodeURIComponent(id)}`;
}

export function projectHref(id: string): string {
  return `/owner/project/${encodeURIComponent(id)}`;
}

export function paymentsHref(id: string): string {
  return `/owner/payments/${encodeURIComponent(id)}`;
}
