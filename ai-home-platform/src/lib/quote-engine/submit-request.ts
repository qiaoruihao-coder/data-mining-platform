import { ZodError } from "zod";
import { Prisma, type PrismaClient } from "@prisma/client";
import { Quote, envelope, type ApiFailure } from "@/contracts";
import { readIdempotencyKey } from "@/lib/idempotency";
import { parseStoredQuoteSource } from "@/lib/quote-policy";
import { readDemoVerifiedSession, providerIdentityFailureResponse, requireProviderIdentity, type VerifiedSessionReader } from "@/lib/server-auth";
import { calculateQuoteSubmission } from "@/lib/quote-engine/submission";
import { createQuoteAtomically, QuoteWriteRejected, type QuoteTransactionSessionReader } from "@/lib/quote-engine/transaction";

/** 只供服务端接入；必须同时提供预检和事务内验证，不能复用预检身份快照。 */
export type QuoteSubmissionAuth = {
  readSession: VerifiedSessionReader;
  readTransactionSession: QuoteTransactionSessionReader;
};

const defaultAuth: QuoteSubmissionAuth = {
  readSession: readDemoVerifiedSession,
  readTransactionSession: readDemoVerifiedSession,
};

export async function handleQuoteSubmission(
  request: Request,
  auth: QuoteSubmissionAuth = defaultAuth,
  db?: Pick<PrismaClient, "$transaction">,
) {
  const identity = await requireProviderIdentity(request, auth.readSession);
  if (!identity.ok) return providerIdentityFailureResponse(identity);
  if (!readIdempotencyKey(request)) {
    return failure(400, "VALIDATION_ERROR", "请提供有效的 Idempotency-Key。");
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return failure(400, "INVALID_JSON", "请求不是有效 JSON。");
  }
  try {
    // 只在此处把输入/计价错误映射为 400；事务内的坏输出不是客户端错误。
    calculateQuoteSubmission(input);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return failure(400, "VALIDATION_ERROR", "报价字段不符合契约，或计算金额超出安全范围。");
  }

  try {
    // 身份、回执和需求均由内核在同一事务复核；外部需求预检会破坏重放错误优先级。
    const result = await createQuoteAtomically(request, input, identity.identity, auth.readTransactionSession, db);
    // 首次和重放均使用原记录来源，不由当前会话重写历史来源。
    const body = envelope(Quote).parse({ ok: true, data: result.quote, meta: { source: parseStoredQuoteSource(result.quote.source) } });
    return Response.json(body, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof QuoteWriteRejected) {
      return failure(error.status, error.code, error.message);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) {
      return failure(503, "DATABASE_UNAVAILABLE", "本次事务因冲突未完成，请保留原幂等键和原输入；这不表示此前的提交未保存。");
    }
    // 包括提交后连接中断：不能用 503 或“未保存”引导客户端直接修改内容重报。
    return failure(500, "INTERNAL_ERROR", "暂时无法确认报价提交结果，请保留原幂等键和原输入并核实，勿换键重复提交。");
  }
}

function failure(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status });
}
