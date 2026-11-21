import type { PrismaClient } from "@prisma/client";
import { Demand, OrderProgressEvent, OrderQuery, envelope, type ApiFailure } from "@/contracts";
import { demandItemSource } from "@/lib/demand";
import { orderInclude, orderSummaryFromRecord } from "@/lib/order";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  VALIDATION_ERROR: { status: 400, message: "请提供唯一且非空的 demandId，不支持其他查询参数。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有业主履约记录读取权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  ORDER_PROGRESS_UNAVAILABLE: { status: 503, message: "暂时无法确认履约记录，请稍后重新读取核实。" },
} as const;
class HistoryRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
// Do not load internal actor identity or user details for the public history DTO.
const eventSelect = { id: true, orderId: true, action: true, fromStatus: true, toStatus: true,
  taskId: true, scheduleVersion: true, createdAt: true } as const;

/** Read stored owner-confirmed actions without replaying them or synthesizing missing history. */
export async function handleOrderProgressHistory(request: Request, db: Database = prisma) {
  if (!["GET", "HEAD"].includes(request.method)) return failure("FORBIDDEN");
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].length !== 1 || !params.has("demandId")) throw new HistoryRejected("VALIDATION_ERROR");
    const query = OrderQuery.safeParse({ demandId: params.get("demandId") });
    if (!query.success) throw new HistoryRejected("VALIDATION_ERROR");
    const body = await db.$transaction(async tx => {
      const identity = await readOwnerVerifiedSession(request, tx);
      if (!identity) throw new HistoryRejected("UNAUTHENTICATED");
      const demand = await tx.demandOrder.findFirst({ where: { id: query.data.demandId, ownerId: identity.userId },
        select: { id: true, ownerId: true, status: true } });
      if (!demand) throw new HistoryRejected("DEMAND_NOT_FOUND");
      if (demand.id !== query.data.demandId || demand.ownerId !== identity.userId) throw new HistoryRejected("ORDER_PROGRESS_UNAVAILABLE");
      Demand.shape.status.parse(demand.status);
      const row = await tx.serviceOrder.findFirst({ where: { demandId: demand.id, demand: { ownerId: identity.userId } }, include: orderInclude });
      const order = row ? orderSummaryFromRecord(row) : null;
      if (order ? order.demandId !== demand.id || order.status !== demand.status : !["draft", "published"].includes(demand.status)) {
        throw new HistoryRejected("ORDER_PROGRESS_UNAVAILABLE");
      }
      const events = order ? await tx.orderProgressEvent.findMany({
        where: { orderId: order.id, order: { demandId: demand.id, demand: { ownerId: identity.userId } } },
        select: eventSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      }) : [];
      const data = events.map(event => {
        if (!order || event.orderId !== order.id || order.status === "contracted"
          || (event.action === "complete" && order.status !== "completed")) throw new HistoryRejected("ORDER_PROGRESS_UNAVAILABLE");
        return OrderProgressEvent.parse({ ...event, createdAt: event.createdAt.toISOString(), source: order.source });
      });
      if (new Set(data.map(event => event.id)).size !== data.length) throw new HistoryRejected("ORDER_PROGRESS_UNAVAILABLE");
      return envelope(OrderProgressEvent.array()).parse({ ok: true, data,
        meta: { source: order?.source ?? demandItemSource(demand.id) } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof HistoryRejected) return failure(error.code);
    if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
    return failure("ORDER_PROGRESS_UNAVAILABLE");
  }
}
