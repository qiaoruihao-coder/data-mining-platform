import { Prisma, type PrismaClient, type Quote as StoredQuote } from "@prisma/client";
import { DatabaseInt, DatabaseMoney, ProviderIdentity, Quote, UserRole, type ProviderIdentityDTO, type QuoteDTO } from "@/contracts";
import { findDemand } from "@/lib/demand";
import { prisma } from "@/lib/prisma";
import { requireProviderIdentity, type VerifiedSessionReader } from "@/lib/server-auth";
import { calculateQuoteSubmission } from "@/lib/quote-engine/submission";
import { hashQuoteSubmission, readIdempotencyKey } from "@/lib/idempotency";
import { authorizeProviderAccount, authorizeProviderQuote, parseStoredQuoteSource } from "@/lib/quote-policy";

/** 服务端适配器必须重新验证会话，并通过本次 tx 核验账户绑定；不能返回预检缓存。 */
export type QuoteTransactionSessionReader = (request: Request, tx: Prisma.TransactionClient) => ReturnType<VerifiedSessionReader>;

export class QuoteWriteRejected extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409, public readonly code: string, message: string) {
    super(message);
    this.name = "QuoteWriteRejected";
  }
}

/**
 * 供公开 POST 使用；调用 D 的冻结协议完成幂等和事务授权，真实会话适配器仍待接入。
 * 不接收预检的需求快照；抛错让事务回滚，提交完成后才向调用方返回 DTO。
 */
export async function createQuoteAtomically(
  request: Request,
  input: unknown,
  expectedIdentity: ProviderIdentityDTO,
  readSession: QuoteTransactionSessionReader,
  db: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<{ quote: QuoteDTO; replayed: boolean }> {
  // 在第一个 await 前校验并复制输入，防止调用方在事务等待期间改变报价或身份。
  const submission = calculateQuoteSubmission(input);
  const expected = ProviderIdentity.parse(expectedIdentity);
  const key = readIdempotencyKey(request);
  if (!key) throw new QuoteWriteRejected(400, "VALIDATION_ERROR", "请提供有效的 Idempotency-Key。");
  const requestHash = hashQuoteSubmission(input);
  if (!DatabaseMoney.safeParse(submission.knownTotalCents).success ||
      !DatabaseInt.safeParse(submission.estimatedDays).success ||
      submission.items.some((item) => item.amountCents !== null && !DatabaseMoney.safeParse(item.amountCents).success)) {
    throw new QuoteWriteRejected(400, "VALIDATION_ERROR", "报价金额或工期超出数据库可保存范围。");
  }

  const run = () => db.$transaction(async (tx) => {
    const current = await requireProviderIdentity(request, (req) => readSession(req, tx));
    if (!current.ok) throw new QuoteWriteRejected(current.status, current.error.code, current.error.message);
    if (current.identity.userId !== expected.userId || current.identity.providerId !== expected.providerId) {
      throw new QuoteWriteRejected(403, "FORBIDDEN", "服务方身份已变化，请重新验证后提交。");
    }

    const user = await tx.user.findUnique({ where: { id: current.identity.userId } });
    const provider = await tx.serviceProvider.findUnique({ where: { id: current.identity.providerId } });
    const role = UserRole.safeParse(user?.role);
    const account = authorizeProviderAccount(current.identity, {
      role: role.success ? role.data : null, providerId: user?.providerId ?? null, providerExists: provider !== null,
    });
    if (!account.ok) throw new QuoteWriteRejected(account.status, account.code, account.message);

    const receipt = await tx.quoteSubmissionReceipt.findUnique({
      where: { providerId_idempotencyKey: { providerId: current.identity.providerId, idempotencyKey: key } },
      include: { quote: true },
    });
    if (receipt && receipt.requestHash !== requestHash) {
      throw new QuoteWriteRejected(409, "IDEMPOTENCY_CONFLICT", "同一幂等键已用于不同报价内容。");
    }

    const demand = await findDemand(submission.demandId, tx);
    if (!demand) throw new QuoteWriteRejected(404, "DEMAND_NOT_FOUND", "这份需求不存在。");
    if (demand.data.id !== submission.demandId) throw new Error("需求查询返回了其他 ID。");
    // 重放也复核当前权限；目前 D 只提供 published 的报价授权，不扩大到其他状态。
    const permission = authorizeProviderQuote(current.identity, demand.data);
    if (!permission.ok) throw new QuoteWriteRejected(permission.status, permission.code, permission.message);

    if (receipt) {
      if (receipt.quote.providerId !== current.identity.providerId || receipt.quote.demandId !== submission.demandId) {
        throw new Error("报价回执关联不一致。");
      }
      return { quote: readQuote(receipt.quote), replayed: true };
    }

    const row = await tx.quote.create({ data: {
      demandId: submission.demandId,
      providerId: current.identity.providerId,
      itemsJson: JSON.stringify(submission.items),
      knownTotalCents: submission.knownTotalCents,
      pendingItemsJson: JSON.stringify(submission.pendingItems),
      estimatedDays: submission.estimatedDays,
      status: "submitted",
      // 当前只开放演示认证；不能从客户端或服务方 ID 推断生产来源。
      source: parseStoredQuoteSource("mock"),
    } });
    const quote = readQuote(row);
    await tx.quoteSubmissionReceipt.create({ data: {
      providerId: current.identity.providerId, idempotencyKey: key, requestHash, quoteId: quote.id,
    } });
    return { quote, replayed: false };
  }, { isolationLevel: "Serializable" });

  // 只重试明确的事务/唯一冲突，每次从认证开始重跑整个事务；未知连接错误向外抛出。
  for (let attempt = 0; ; attempt++) {
    try { return await run(); } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          (error.code !== "P2034" && error.code !== "P2002")) throw error;
    }
  }
}

function readQuote(row: StoredQuote): QuoteDTO {
  // 输出校验也在事务内；损坏数据不能变成成功回执。
  return Quote.parse({
      id: row.id, demandId: row.demandId, providerId: row.providerId,
      source: parseStoredQuoteSource(row.source),
      items: JSON.parse(row.itemsJson), knownTotalCents: row.knownTotalCents,
      pendingItems: JSON.parse(row.pendingItemsJson), estimatedDays: row.estimatedDays, status: row.status,
  });
}
