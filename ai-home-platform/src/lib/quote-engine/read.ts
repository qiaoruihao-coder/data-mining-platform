import type { Prisma, PrismaClient } from "@prisma/client";
import { DemandIdParams, Quote, envelope } from "@/contracts";
import { findDemand } from "@/lib/demand";
import { prisma } from "@/lib/prisma";
import { prepareQuotes } from "@/lib/quote-engine";
import { parseStoredQuoteSource, summarizeQuoteSources } from "@/lib/quote-policy";

/** D 的服务端读取授权适配器须在当前事务核验会话、账户和需求归属，不能使用预检快照。 */
export type QuoteReadAuthorization = (request: Request, demandId: string, tx: Prisma.TransactionClient) => boolean | Promise<boolean>;

export class QuoteReadDenied extends Error {
  constructor() {
    super("尚未获得该需求的报价读取权限。");
    this.name = "QuoteReadDenied";
  }
}

/** 供公开 GET 使用；授权与数据读取在同一事务内，HTTP 错误由 read-request 映射。 */
export async function readStoredQuoteComparison(
  request: Request,
  demandId: string,
  authorizeRead: QuoteReadAuthorization,
  db: Pick<PrismaClient, "$transaction"> = prisma,
) {
  const { id } = DemandIdParams.parse({ id: demandId });
  return db.$transaction(async (tx) => {
    // 只接受明确的 true；遗忘返回值、错误类型或拒绝都不能继续读取。
    if (await authorizeRead(request, id, tx) !== true) throw new QuoteReadDenied();
    const demand = await findDemand(id, tx);
    if (!demand) return null;
    if (demand.data.id !== id) throw new Error("需求查询返回了其他 ID。");

    const rows = await tx.quote.findMany({
      where: { demandId: id, status: { in: ["submitted", "accepted"] } },
      // 当前 Quote 没有版本/提交时间字段；固定 ID 顺序不表示最新版本、价格或质量排名。
      orderBy: { id: "asc" },
    });
    const quotes = rows.map((row) => {
      // 除 SQL 范围外再核验一次，损坏或错位结果不能被静默变成空成功。
      if (row.demandId !== id || (row.status !== "submitted" && row.status !== "accepted")) {
        throw new Error("报价查询结果超出当前需求的可对比范围。");
      }
      return Quote.parse({
        id: row.id, demandId: row.demandId, providerId: row.providerId,
        source: parseStoredQuoteSource(row.source),
        items: JSON.parse(row.itemsJson), pendingItems: JSON.parse(row.pendingItemsJson),
        knownTotalCents: row.knownTotalCents, estimatedDays: row.estimatedDays, status: row.status,
      });
    });
    const returnedQuotes = prepareQuotes(id, quotes);
    return {
      demand: demand.data,
      response: envelope(Quote.array()).parse({
        ok: true, data: returnedQuotes, meta: { source: summarizeQuoteSources(demand.source, returnedQuotes) },
      }),
    };
  }, { isolationLevel: "Serializable" });
}
