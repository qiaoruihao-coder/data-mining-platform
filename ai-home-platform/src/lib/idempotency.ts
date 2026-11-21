import { createHash } from "node:crypto";
import {
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKey,
  QuoteSubmissionInput,
  type IdempotencyKeyDTO,
  type QuoteSubmissionInputDTO,
} from "@/contracts";

export function readIdempotencyKey(request: Request): IdempotencyKeyDTO | null {
  const value = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  const parsed = IdempotencyKey.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * 只对公共输入的规范化字段做摘要；字段顺序固定，保留明细顺序、null 与 0。
 * 摘要用于识别重试，不可单独替代 (providerId, key) 唯一约束。
 */
export function canonicalizeQuoteSubmission(input: unknown): string {
  const parsed = QuoteSubmissionInput.parse(input);
  const canonical: QuoteSubmissionInputDTO = {
    demandId: parsed.demandId,
    estimatedDays: parsed.estimatedDays,
    items: parsed.items.map((item) => ({
      code: item.code,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      note: item.note,
    })),
  };
  return JSON.stringify(canonical);
}

export function hashQuoteSubmission(input: unknown): string {
  return createHash("sha256").update(canonicalizeQuoteSubmission(input), "utf8").digest("hex");
}
