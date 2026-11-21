import { Money } from "@/contracts";

/** 只在展示时将分换算为元；未知金额始终保留“待确认”。 */
export function formatQuoteMoney(cents: number | null): string {
  if (cents === null) return "待确认";
  Money.parse(cents);
  // 分开格式化整数元和余下的分，避免大金额除以 100 后丢失分位精度。
  return `¥${Math.floor(cents / 100).toLocaleString("zh-CN")}.${String(cents % 100).padStart(2, "0")}`;
}
