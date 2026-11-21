import type { PrismaClient } from "@prisma/client";
import { Quote, envelope, type ApiFailure } from "@/contracts";
import { readDemoVerifiedSession } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { parseStoredQuoteSource } from "@/lib/quote-source";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  VALIDATION_ERROR: { status: 400, message: "本人报价查询不接受查询参数。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成服务方登录。" },
  FORBIDDEN: { status: 403, message: "当前身份没有服务方报价查询权限。" },
  DATABASE_UNAVAILABLE: { status: 503, message: "本人报价暂时无法读取，请稍后重试。" },
} as const;
class ProviderQuotesRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}

/** Quote records only: this does not manufacture order/fulfilment relationships. */
export async function handleProviderQuotes(request: Request, db: Pick<PrismaClient, "$transaction"> = prisma) {
  if ([...new URL(request.url).searchParams].length) return failure("VALIDATION_ERROR");
  if (request.method !== "GET") return failure("FORBIDDEN");
  try {
    const body = await db.$transaction(async tx => {
      const identity = await readDemoVerifiedSession(request, tx);
      if (!identity) {
        if (await readOwnerVerifiedSession(request, tx)) throw new ProviderQuotesRejected("FORBIDDEN");
        throw new ProviderQuotesRejected("UNAUTHENTICATED");
      }
      if (identity.role !== "provider" || identity.providerId === null) throw new ProviderQuotesRejected("FORBIDDEN");
      const rows = await tx.quote.findMany({ where: { providerId: identity.providerId }, orderBy: { id: "asc" } });
      const quotes = rows.map(row => {
        if (row.providerId !== identity.providerId) throw new ProviderQuotesRejected("DATABASE_UNAVAILABLE");
        return Quote.parse({
          id: row.id, demandId: row.demandId, providerId: row.providerId, source: parseStoredQuoteSource(row.source),
          items: JSON.parse(row.itemsJson), pendingItems: JSON.parse(row.pendingItemsJson),
          knownTotalCents: row.knownTotalCents, estimatedDays: row.estimatedDays, status: row.status,
        });
      });
      if (new Set(quotes.map(quote => quote.id)).size !== quotes.length) throw new ProviderQuotesRejected("DATABASE_UNAVAILABLE");
      // Authentication is explicitly a demo identity; persisted records never promote it to live.
      return envelope(Quote.array()).parse({ ok: true, data: quotes, meta: { source: "mock" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof ProviderQuotesRejected) return failure(error.code);
    if (error instanceof OwnerAccessError && error.code === "FORBIDDEN") return failure("FORBIDDEN");
    return failure("DATABASE_UNAVAILABLE");
  }
}
