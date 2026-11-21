import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, Review as StoredReview } from "@prisma/client";
import { Review, ReviewInput, ReviewQuery, envelope, type ApiFailure, type OrderSummaryDTO } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { orderInclude, orderSummaryFromRecord } from "@/lib/order";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "评价字段或查询参数不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有业主评价权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能提交评价。" },
  REVIEW_NOT_ALLOWED: { status: 409, message: "仅实际接单与需求均已完成时可评价，请刷新核实。" },
  REVIEW_PROVIDER_MISMATCH: { status: 409, message: "评价对象与实际接单服务方不一致，请刷新核实。" },
  REVIEW_ALREADY_EXISTS: { status: 409, message: "该接单已有不同内容的评价，请读取核实，不能覆盖。" },
  REVIEW_UNAVAILABLE: { status: 503, message: "暂时无法确认评价数据，请先读取核实后再决定是否重试。" },
} as const;
class ReviewRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
function rejected(error: unknown) {
  if (error instanceof ReviewRejected) return failure(error.code);
  if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
  return failure("REVIEW_UNAVAILABLE");
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new ReviewRejected("UNAUTHENTICATED");
  return identity;
}
async function ownedDemand(tx: Prisma.TransactionClient, demandId: string, ownerId: string) {
  const demand = await tx.demandOrder.findFirst({
    where: { id: demandId, ownerId }, select: { id: true, ownerId: true, status: true },
  });
  if (!demand) throw new ReviewRejected("DEMAND_NOT_FOUND");
  if (demand.id !== demandId || demand.ownerId !== ownerId) throw new ReviewRejected("REVIEW_UNAVAILABLE");
  return demand;
}
async function ownedOrder(tx: Prisma.TransactionClient, demandId: string, ownerId: string) {
  const row = await tx.serviceOrder.findFirst({
    where: { demandId, demand: { ownerId } }, include: orderInclude,
  });
  if (!row) return null;
  const data = orderSummaryFromRecord(row);
  if (data.demandId !== demandId) throw new ReviewRejected("REVIEW_UNAVAILABLE");
  return { row, data };
}
async function storedReview(tx: Prisma.TransactionClient, demandId: string, order: OrderSummaryDTO | null) {
  // Include a misbound review of this order so corrupt/legacy records cannot become a false empty result.
  const rows = await tx.review.findMany({ where: { OR: [{ demandId }, ...(order ? [{ orderId: order.id }] : [])] }, take: 2 });
  if (rows.length > 1) throw new ReviewRejected("REVIEW_UNAVAILABLE");
  return rows.length ? reviewDTO(rows[0], order) : null;
}
function reviewDTO(row: StoredReview, order: OrderSummaryDTO | null) {
  const data = Review.parse(row);
  if (!order || order.status !== "completed" || data.orderId !== order.id || data.demandId !== order.demandId
    || data.providerId !== order.providerId || data.source !== order.source) throw new ReviewRejected("REVIEW_UNAVAILABLE");
  return data;
}
async function readInput(request: Request) {
  if (!request.body) throw new ReviewRejected("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new ReviewRejected("VALIDATION_ERROR"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ReviewRejected("INVALID_JSON"); }
  const parsed = ReviewInput.safeParse(json);
  if (!parsed.success) throw new ReviewRejected("VALIDATION_ERROR");
  return parsed.data;
}

/** Store one owner's feedback on an actual completed relationship; never advance fulfillment or scores. */
export async function handleReviewCreate(request: Request, db: Database = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    const input = await readInput(request);
    const result = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new ReviewRejected("FORBIDDEN");
      const demand = await ownedDemand(tx, input.demandId, current.userId);
      if (demand.id === DEMO_DEMAND_ID) throw new ReviewRejected("DEMO_DEMAND_READ_ONLY");
      const order = await ownedOrder(tx, demand.id, current.userId);
      const existing = await storedReview(tx, demand.id, order?.data ?? null);
      if (!order || demand.status !== "completed" || order.data.status !== "completed") throw new ReviewRejected("REVIEW_NOT_ALLOWED");
      if (order.data.providerId !== input.providerId) throw new ReviewRejected("REVIEW_PROVIDER_MISMATCH");
      if (existing) {
        if (existing.rating !== input.rating || existing.comment !== input.comment) throw new ReviewRejected("REVIEW_ALREADY_EXISTS");
        return { status: 200, body: envelope(Review).parse({ ok: true, data: existing, meta: { source: existing.source } }) };
      }
      const planned = Review.parse({ ...input, id: randomUUID(), orderId: order.data.id, source: order.data.source });
      const quote = order.row.acceptedQuote;
      // Guard ownership, completed states, the same accepted quote and absence of any review at the final write.
      await tx.demandOrder.update({
        where: { id: demand.id, ownerId: current.userId, status: "completed", reviews: { none: {} },
          serviceOrder: { is: { ...order.data, review: { is: null }, acceptedQuote: { is: {
            id: quote.id, demandId: demand.id, providerId: planned.providerId, source: planned.source, status: "accepted",
            itemsJson: quote.itemsJson, pendingItemsJson: quote.pendingItemsJson,
            knownTotalCents: quote.knownTotalCents, estimatedDays: quote.estimatedDays,
          } } } } },
        data: { reviews: { create: { id: planned.id, orderId: planned.orderId, providerId: planned.providerId,
          source: planned.source, rating: planned.rating, comment: planned.comment } } }, select: { id: true },
      });
      const verifiedOrder = await ownedOrder(tx, demand.id, current.userId);
      const data = reviewDTO(await tx.review.findUniqueOrThrow({ where: { id: planned.id } }), verifiedOrder?.data ?? null);
      if (JSON.stringify(data) !== JSON.stringify(planned)) throw new ReviewRejected("REVIEW_UNAVAILABLE");
      return { status: 201, body: envelope(Review).parse({ ok: true, data, meta: { source: data.source } }) };
    }, { isolationLevel: "Serializable" });
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) { return rejected(error); }
}

export async function handleReviewRead(request: Request, db: Database = prisma) {
  if (!["GET", "HEAD"].includes(request.method)) return failure("FORBIDDEN");
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].length !== 1 || !params.has("demandId")) throw new ReviewRejected("VALIDATION_ERROR");
    const query = ReviewQuery.safeParse({ demandId: params.get("demandId") });
    if (!query.success) throw new ReviewRejected("VALIDATION_ERROR");
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      const demand = await ownedDemand(tx, query.data.demandId, current.userId);
      const order = await ownedOrder(tx, demand.id, current.userId);
      const review = await storedReview(tx, demand.id, order?.data ?? null);
      return envelope(Review.array()).parse({ ok: true, data: review ? [review] : [],
        meta: { source: review?.source ?? (demand.id === DEMO_DEMAND_ID ? "mock" : "live") } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) { return rejected(error); }
}
