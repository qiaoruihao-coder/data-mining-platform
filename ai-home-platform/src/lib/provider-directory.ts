import type { Prisma, PrismaClient } from "@prisma/client";
import { Demand, OrderSummary, Provider, ProviderPerformance, ProviderQuery, Quote, Review, envelope,
  type ApiFailure, type ProviderQueryDTO } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { providers } from "@/lib/mock-data";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;
const headers = { "Cache-Control": "no-store" } as const;
const failures = {
  VALIDATION_ERROR: { status: 400, message: "仅支持单个 performanceSource=live 或 mock 查询参数。" },
  PROVIDER_UNAVAILABLE: { status: 503, message: "暂时无法确认服务方评价汇总，请稍后重试。" },
} as const;
export class ProviderDirectoryError extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
const demandSelect = { id: true, ownerId: true, status: true } as const;
// Select only fields needed to validate the aggregate; never load private review comments.
const reviewSelect = {
  id: true, orderId: true, demandId: true, providerId: true, rating: true, source: true,
  demand: { select: demandSelect },
  order: { select: {
    id: true, demandId: true, providerId: true, acceptedQuoteId: true, status: true, source: true,
    demand: { select: demandSelect },
    acceptedQuote: { select: { id: true, demandId: true, providerId: true, status: true, source: true } },
  } },
} as const;
const ReviewSample = Review.pick({ id: true, orderId: true, demandId: true, providerId: true, rating: true, source: true });
const AcceptedQuote = Quote.pick({ id: true, demandId: true, providerId: true, status: true }).extend({ source: OrderSummary.shape.source });
function validSample(row: Prisma.ReviewGetPayload<{ select: typeof reviewSelect }>, directoryIds: Set<string>) {
  const sample = ReviewSample.parse({ id: row.id, orderId: row.orderId, demandId: row.demandId,
    providerId: row.providerId, rating: row.rating, source: row.source });
  if (!row.order || !row.demand || !row.order.demand || !row.order.acceptedQuote) throw new ProviderDirectoryError("PROVIDER_UNAVAILABLE");
  const order = OrderSummary.parse({ id: row.order.id, demandId: row.order.demandId, providerId: row.order.providerId,
    acceptedQuoteId: row.order.acceptedQuoteId, status: row.order.status, source: row.order.source });
  const quote = AcceptedQuote.parse(row.order.acceptedQuote);
  Demand.shape.status.parse(row.demand.status);
  if (!directoryIds.has(sample.providerId) || sample.demandId === DEMO_DEMAND_ID
    || sample.orderId !== order.id || sample.demandId !== order.demandId || sample.providerId !== order.providerId
    || row.demand.id !== sample.demandId || row.order.demand.id !== order.demandId
    || !row.demand.ownerId || row.demand.ownerId !== row.order.demand.ownerId
    || row.demand.status !== order.status || row.order.demand.status !== order.status
    || quote.id !== order.acceptedQuoteId || quote.demandId !== order.demandId || quote.providerId !== order.providerId
    || quote.status !== "accepted" || quote.source !== order.source || sample.source !== order.source) {
    throw new ProviderDirectoryError("PROVIDER_UNAVAILABLE");
  }
  return { ...sample, completed: order.status === "completed" };
}

/** Public fixed directory with source-separated review aggregates. Shared by HTTP and future matching callers. */
export async function readProviderDirectory(query: ProviderQueryDTO = { performanceSource: "live" }, db: Database = prisma) {
  const parsed = ProviderQuery.safeParse(query);
  if (!parsed.success) throw new ProviderDirectoryError("VALIDATION_ERROR");
  try {
    return await db.$transaction(async tx => {
      const directory = Provider.array().parse(providers);
      const ids = directory.map(provider => provider.id);
      const directoryIds = new Set(ids);
      if (directoryIds.size !== ids.length) throw new ProviderDirectoryError("PROVIDER_UNAVAILABLE");
      const rows = await tx.review.findMany({ where: { orderId: { not: null }, OR: [
        { providerId: { in: ids } }, { order: { providerId: { in: ids } } },
        { demand: { serviceOrder: { providerId: { in: ids } } } },
      ] }, select: reviewSelect });
      const seen = new Set<string>();
      const totals = new Map<string, { count: number; sum: number }>();
      for (const row of rows) {
        const sample = validSample(row, directoryIds);
        if (seen.has(sample.orderId)) throw new ProviderDirectoryError("PROVIDER_UNAVAILABLE");
        seen.add(sample.orderId);
        if (!sample.completed || sample.source !== parsed.data.performanceSource) continue;
        const total = totals.get(sample.providerId) ?? { count: 0, sum: 0 };
        total.count++; total.sum += sample.rating;
        if (!Number.isSafeInteger(total.count) || !Number.isSafeInteger(total.sum)) throw new ProviderDirectoryError("PROVIDER_UNAVAILABLE");
        totals.set(sample.providerId, total);
      }
      const calculatedAt = new Date().toISOString();
      const data = directory.map(provider => {
        const total = totals.get(provider.id);
        const performance = ProviderPerformance.parse({ basis: "completed_order_review_average",
          averageRating: total ? Math.round(total.sum / total.count * 100) / 100 : null,
          reviewCount: total?.count ?? 0, calculatedAt, source: parsed.data.performanceSource });
        return { ...provider, source: "mock" as const, performance };
      });
      // The directory itself is still the original synthetic catalogue, even for live-only review statistics.
      return envelope(Provider.array()).parse({ ok: true, data, meta: { source: "mock" } });
    }, { isolationLevel: "Serializable" });
  } catch { throw new ProviderDirectoryError("PROVIDER_UNAVAILABLE"); }
}

export async function handleProviderDirectory(request: Request, db: Database = prisma) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "performanceSource") || params.getAll("performanceSource").length > 1) {
      throw new ProviderDirectoryError("VALIDATION_ERROR");
    }
    const query = ProviderQuery.safeParse(params.has("performanceSource") ? { performanceSource: params.get("performanceSource") } : {});
    if (!query.success) throw new ProviderDirectoryError("VALIDATION_ERROR");
    return Response.json(await readProviderDirectory(query.data, db), { headers });
  } catch (error) {
    const code = error instanceof ProviderDirectoryError ? error.code : "PROVIDER_UNAVAILABLE";
    return Response.json({ ok: false, error: { code, message: failures[code].message } } satisfies ApiFailure,
      { status: failures[code].status, headers });
  }
}
