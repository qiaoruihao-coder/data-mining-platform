import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, Quote as StoredQuote } from "@prisma/client";
import { Demand, OrderAcceptInput, OrderQuery, OrderSummary, OwnerOrderResult, Quote, Source, envelope, type ApiFailure } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { isSameOrigin, readDemoVerifiedSession } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "接单字段或查询参数不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成当前操作所需的登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有接单操作权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  QUOTE_NOT_FOUND: { status: 404, message: "该需求中不存在可访问的目标报价。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能接受报价。" },
  INVALID_STATE: { status: 409, message: "仅已发布需求的已提交报价可首次接受，请刷新核实。" },
  ORDER_ALREADY_EXISTS: { status: 409, message: "该需求已接受其他报价，不能改选。" },
  ACCEPTED_QUOTE_CONFLICT: { status: 409, message: "需求已有接受记录但缺少接单关系，请联系维护者核实。" },
  ORDER_UNAVAILABLE: { status: 503, message: "暂时无法确认接单数据，请稍后重新读取核实。" },
} as const;
class OrderRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
function rejected(error: unknown) {
  if (error instanceof OrderRejected) return failure(error.code);
  if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
  return failure("ORDER_UNAVAILABLE");
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new OrderRejected("UNAUTHENTICATED");
  return identity;
}
async function readInput(request: Request) {
  if (!request.body) throw new OrderRejected("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new OrderRejected("VALIDATION_ERROR"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new OrderRejected("INVALID_JSON"); }
  const parsed = OrderAcceptInput.safeParse(json);
  if (!parsed.success) throw new OrderRejected("VALIDATION_ERROR");
  return parsed.data;
}
function quoteDTO(row: StoredQuote) {
  return Quote.parse({ ...row, source: Source.parse(row.source),
    items: JSON.parse(row.itemsJson), pendingItems: JSON.parse(row.pendingItemsJson) });
}
export const orderInclude = { demand: { select: { id: true, status: true } }, acceptedQuote: true } as const;
type OrderRow = Prisma.ServiceOrderGetPayload<{ include: typeof orderInclude }>;
export function orderSummaryFromRecord(row: OrderRow) {
  const quote = quoteDTO(row.acceptedQuote);
  const data = OrderSummary.parse({ id: row.id, demandId: row.demandId, providerId: row.providerId,
    acceptedQuoteId: row.acceptedQuoteId, source: row.source, status: row.status });
  if (data.demandId === DEMO_DEMAND_ID || row.demand.id !== data.demandId || row.demand.status !== data.status
    || quote.id !== data.acceptedQuoteId || quote.demandId !== data.demandId || quote.providerId !== data.providerId
    || quote.status !== "accepted" || quote.source !== data.source) throw new OrderRejected("ORDER_UNAVAILABLE");
  return data;
}

/** One demand, one accepted quote and one relationship, committed together. */
export async function handleOrderAccept(request: Request, db: Database = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    const input = await readInput(request);
    const result = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new OrderRejected("FORBIDDEN");
      const demand = await tx.demandOrder.findFirst({
        where: { id: input.demandId, ownerId: current.userId }, select: { id: true, ownerId: true, status: true },
      });
      if (!demand) throw new OrderRejected("DEMAND_NOT_FOUND");
      if (demand.id !== input.demandId || demand.ownerId !== current.userId) throw new OrderRejected("ORDER_UNAVAILABLE");
      if (demand.id === DEMO_DEMAND_ID) throw new OrderRejected("DEMO_DEMAND_READ_ONLY");
      const existing = await tx.serviceOrder.findFirst({
        where: { demandId: demand.id, demand: { ownerId: current.userId } }, include: orderInclude,
      });
      if (existing) {
        const data = orderSummaryFromRecord(existing);
        if (data.demandId !== demand.id) throw new OrderRejected("ORDER_UNAVAILABLE");
        if (data.acceptedQuoteId !== input.quoteId) throw new OrderRejected("ORDER_ALREADY_EXISTS");
        return { status: 200, body: envelope(OrderSummary).parse({ ok: true, data, meta: { source: data.source } }) };
      }
      if (demand.status !== "published") throw new OrderRejected("INVALID_STATE");
      const row = await tx.quote.findFirst({ where: { id: input.quoteId, demandId: demand.id } });
      if (!row) throw new OrderRejected("QUOTE_NOT_FOUND");
      const quote = quoteDTO(row);
      if (quote.id !== input.quoteId || quote.demandId !== demand.id) throw new OrderRejected("ORDER_UNAVAILABLE");
      if (await tx.quote.findFirst({ where: { demandId: demand.id, status: "accepted" }, select: { id: true } })) {
        throw new OrderRejected("ACCEPTED_QUOTE_CONFLICT");
      }
      if (quote.status !== "submitted") throw new OrderRejected("INVALID_STATE");
      const planned = OrderSummary.parse({ id: randomUUID(), demandId: demand.id, providerId: quote.providerId,
        acceptedQuoteId: quote.id, status: "contracted", source: quote.source });
      const unchangedQuote = { id: row.id, demandId: row.demandId, providerId: row.providerId, status: "submitted",
        source: row.source, itemsJson: row.itemsJson, pendingItemsJson: row.pendingItemsJson,
        knownTotalCents: row.knownTotalCents, estimatedDays: row.estimatedDays };
      // The final state change also guards ownership, the original quote and absence of a winner.
      const changedDemand = await tx.demandOrder.updateMany({
        where: { id: demand.id, ownerId: current.userId, status: "published", serviceOrder: { is: null },
          quotes: { some: unchangedQuote, none: { status: "accepted" } } }, data: { status: "contracted" },
      });
      if (changedDemand.count !== 1) throw new OrderRejected("INVALID_STATE");
      const changedQuote = await tx.quote.updateMany({ where: { ...unchangedQuote,
        demand: { ownerId: current.userId, status: "contracted" } }, data: { status: "accepted" } });
      if (changedQuote.count !== 1) throw new OrderRejected("INVALID_STATE");
      await tx.serviceOrder.create({ data: planned });
      const data = orderSummaryFromRecord(await tx.serviceOrder.findUniqueOrThrow({ where: { id: planned.id }, include: orderInclude }));
      if (JSON.stringify(data) !== JSON.stringify(planned)) throw new OrderRejected("ORDER_UNAVAILABLE");
      return { status: 201, body: envelope(OrderSummary).parse({ ok: true, data, meta: { source: data.source } }) };
    }, { isolationLevel: "Serializable" });
    return Response.json(result.body, { status: result.status, headers });
  } catch (error) { return rejected(error); }
}

/** Read the current owner's order without replaying an acceptance or changing business data. */
export async function handleOwnerOrderRead(request: Request, db: Database = prisma) {
  if (!["GET", "HEAD"].includes(request.method)) return failure("FORBIDDEN");
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].length !== 1 || !params.has("demandId")) throw new OrderRejected("VALIDATION_ERROR");
    const query = OrderQuery.safeParse({ demandId: params.get("demandId") });
    if (!query.success) throw new OrderRejected("VALIDATION_ERROR");
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      const demand = await tx.demandOrder.findFirst({ where: { id: query.data.demandId, ownerId: current.userId },
        select: { id: true, ownerId: true, status: true } });
      if (!demand) throw new OrderRejected("DEMAND_NOT_FOUND");
      if (demand.id !== query.data.demandId || demand.ownerId !== current.userId) throw new OrderRejected("ORDER_UNAVAILABLE");
      Demand.shape.status.parse(demand.status);
      const row = await tx.serviceOrder.findFirst({ where: { demandId: demand.id, demand: { ownerId: current.userId } }, include: orderInclude });
      const data = row ? orderSummaryFromRecord(row) : null;
      if (data ? data.demandId !== demand.id || data.status !== demand.status : !["draft", "published"].includes(demand.status)) {
        throw new OrderRejected("ORDER_UNAVAILABLE");
      }
      return envelope(OwnerOrderResult).parse({ ok: true, data,
        meta: { source: data?.source ?? (demand.id === DEMO_DEMAND_ID ? "mock" : "live") } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) { return rejected(error); }
}

/** Query actual relationships; historical accepted quotes do not create orders. */
export async function handleProviderOrders(request: Request, db: Database = prisma) {
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  if (request.method !== "GET") return failure("FORBIDDEN");
  try {
    const body = await db.$transaction(async tx => {
      const identity = await readDemoVerifiedSession(request, tx);
      if (!identity) {
        if (await readOwnerVerifiedSession(request, tx)) throw new OrderRejected("FORBIDDEN");
        throw new OrderRejected("UNAUTHENTICATED");
      }
      if (identity.role !== "provider" || identity.providerId === null) throw new OrderRejected("FORBIDDEN");
      const rows = await tx.serviceOrder.findMany({ where: { providerId: identity.providerId }, orderBy: { id: "asc" }, include: orderInclude });
      const data = rows.map(row => {
        if (row.providerId !== identity.providerId) throw new OrderRejected("ORDER_UNAVAILABLE");
        return orderSummaryFromRecord(row);
      });
      if (new Set(data.map(order => order.id)).size !== data.length) throw new OrderRejected("ORDER_UNAVAILABLE");
      // Current provider authentication is a demo, including for an empty or live-record list.
      return envelope(OrderSummary.array()).parse({ ok: true, data, meta: { source: "mock" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) { return rejected(error); }
}
