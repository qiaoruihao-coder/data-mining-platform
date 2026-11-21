import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { Ticket, TicketCreateInput, TicketQuery, envelope, type ApiFailure } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { tickets } from "@/lib/mock-data";
import { OWNER_SESSION_COOKIE, OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

type Database = Pick<PrismaClient, "$transaction">;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const writableStates = ["published", "contracted", "in_progress", "completed"];
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "工单字段或查询参数不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有业主工单访问权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能提交工单。" },
  INVALID_STATE: { status: 409, message: "需求发布后才能提交工单。" },
  TICKET_UNAVAILABLE: { status: 503, message: "暂时无法确认工单数据，请刷新后核实。" },
} as const;
class TicketRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
function rejected(error: unknown) {
  if (error instanceof TicketRejected) return failure(error.code);
  if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
  return failure("TICKET_UNAVAILABLE");
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new TicketRejected("UNAUTHENTICATED");
  return identity;
}
async function ownedDemand(tx: Prisma.TransactionClient, demandId: string, ownerId: string) {
  const demand = await tx.demandOrder.findFirst({
    where: { id: demandId, ownerId }, select: { id: true, ownerId: true, status: true },
  });
  if (!demand) throw new TicketRejected("DEMAND_NOT_FOUND");
  if (demand.id !== demandId || demand.ownerId !== ownerId) throw new TicketRejected("TICKET_UNAVAILABLE");
  return demand;
}
async function readInput(request: Request) {
  if (!request.body) throw new TicketRejected("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw new TicketRejected("VALIDATION_ERROR"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new TicketRejected("INVALID_JSON"); }
  const input = TicketCreateInput.safeParse(json);
  if (!input.success) throw new TicketRejected("VALIDATION_ERROR");
  return input.data;
}

/** A report is saved as open and unassigned; it does not establish responsibility. */
export async function handleTicketCreate(request: Request, db: Database = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    const input = await readInput(request);
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new TicketRejected("FORBIDDEN");
      const demand = await ownedDemand(tx, input.demandId, current.userId);
      if (demand.id === DEMO_DEMAND_ID) throw new TicketRejected("DEMO_DEMAND_READ_ONLY");
      if (!writableStates.includes(demand.status)) throw new TicketRejected("INVALID_STATE");
      const planned = Ticket.parse({ ...input, id: randomUUID(), status: "open", responsibleProviderId: null });
      await tx.demandOrder.update({
        where: { id: demand.id, ownerId: current.userId, status: demand.status },
        data: { tickets: { create: { id: planned.id, description: planned.description,
          category: planned.category, status: planned.status, responsibleProviderId: planned.responsibleProviderId } } },
        select: { id: true },
      });
      const data = Ticket.parse(await tx.ticket.findUniqueOrThrow({ where: { id: planned.id } }));
      if (JSON.stringify(data) !== JSON.stringify(planned)) throw new TicketRejected("TICKET_UNAVAILABLE");
      return envelope(Ticket).parse({ ok: true, data, meta: { source: "live" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { status: 201, headers });
  } catch (error) { return rejected(error); }
}

function parseQuery(params: URLSearchParams) {
  const keys = [...params.keys()];
  if (keys.length === 0) return null;
  if (keys.length !== 1 || keys[0] !== "demandId") throw new TicketRejected("VALIDATION_ERROR");
  const parsed = TicketQuery.safeParse({ demandId: params.get("demandId") });
  if (!parsed.success) throw new TicketRejected("VALIDATION_ERROR");
  return parsed.data;
}
function demoTickets() {
  // Fixed seed only: never expose mutable database records via the public demo entry.
  return envelope(Ticket.array()).parse({ ok: true, data: tickets, meta: { source: "mock" } });
}
export async function handleTicketRead(request: Request, db: Database = prisma) {
  if (!["GET", "HEAD"].includes(request.method)) return failure("FORBIDDEN");
  try {
    const query = parseQuery(new URL(request.url).searchParams);
    const demo = query === null || query.demandId === DEMO_DEMAND_ID;
    const hasOwnerCookie = (request.headers.get("cookie") ?? "").split(";")
      .some(value => value.trim().startsWith(`${OWNER_SESSION_COOKIE}=`));
    if (demo && !hasOwnerCookie) return Response.json(demoTickets(), { headers });
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (!query || query.demandId === DEMO_DEMAND_ID) return demoTickets();
      const demand = await ownedDemand(tx, query.demandId, current.userId);
      const rows = await tx.ticket.findMany({
        where: { demandId: demand.id, demand: { ownerId: current.userId } }, orderBy: { id: "asc" },
      });
      const data = Ticket.array().parse(rows);
      if (data.some(row => row.demandId !== demand.id)) throw new TicketRejected("TICKET_UNAVAILABLE");
      return envelope(Ticket.array()).parse({ ok: true, data, meta: { source: "live" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) { return rejected(error); }
}
