import { IdempotencyKey, QuoteSubmissionInput, type QuoteSubmissionInputDTO } from "@/contracts";
import { ApiClientError } from "@/lib/api-client";

/** 每个表单独立持有；仅点击提交时生成键，不存储身份或写入浏览器存储。 */
export function createQuoteSubmissionSession() {
  let attempt: { input: QuoteSubmissionInputDTO; idempotencyKey: string } | null = null;

  return {
    prepare(input: QuoteSubmissionInputDTO) {
      const parsed = QuoteSubmissionInput.parse(input);
      if (attempt && JSON.stringify(attempt.input) === JSON.stringify(parsed)) return attempt;

      let idempotencyKey: string;
      try {
        idempotencyKey = IdempotencyKey.parse(globalThis.crypto.randomUUID());
      } catch {
        throw new ApiClientError("无法生成报价提交标识。", "LOCAL_IDEMPOTENCY_KEY_UNAVAILABLE", 400);
      }
      attempt = { input: parsed, idempotencyKey };
      return attempt;
    },
    invalidate() {
      // 即使编辑后改回原值，也代表用户重新准备了一次提交。
      attempt = null;
    },
  };
}
