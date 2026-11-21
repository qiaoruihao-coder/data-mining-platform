import { ZodError } from "zod";
import { Money, QuoteSubmissionInput, type QuoteDTO } from "@/contracts";

function toSafeMoney(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZodError([{ code: "custom", path: [], message: "计算金额超出安全整数范围。" }]);
  }
  return Money.parse(Number(value));
}

/** 计价仅生成报价业务字段；不分配身份、ID、状态或成功信封，也不执行写入。 */
export function calculateQuoteSubmission(value: unknown): Pick<QuoteDTO, "demandId" | "estimatedDays" | "items" | "knownTotalCents" | "pendingItems"> {
  const input = QuoteSubmissionInput.parse(value);
  let totalCents = 0n;
  const items = input.items.map((item) => {
    if (item.unitPriceCents === null) return { ...item, amountCents: null };
    // Schema 限定数量为 0.001–1000000、至多三位小数，因此规范字符串不含指数。
    const [whole, fraction = ""] = item.quantity.toString().split(".");
    const quantityMilli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
    const amountCents = (quantityMilli * BigInt(item.unitPriceCents) + 500n) / 1000n;
    totalCents += amountCents;
    return { ...item, amountCents: toSafeMoney(amountCents) };
  });
  return {
    demandId: input.demandId,
    estimatedDays: input.estimatedDays,
    items,
    knownTotalCents: toSafeMoney(totalCents),
    // 同名但不同 code 的未知费用分别保留，不能按名称去重。
    pendingItems: items.filter((item) => item.amountCents === null).map((item) => item.name),
  };
}
