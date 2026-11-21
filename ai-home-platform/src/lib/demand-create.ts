import type { Prisma, PrismaClient } from "@prisma/client";
import { Demand, DemandInput, envelope, type ApiFailure } from "@/contracts";
import { toDemandDTO } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "需求字段不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录后发布需求。" },
  FORBIDDEN: { status: 403, message: "当前请求没有需求创建权限。" },
  DATABASE_UNAVAILABLE: { status: 503, message: "暂时无法确认需求创建结果，请刷新后核实。" },
} as const;
class DemandCreateRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new DemandCreateRejected("UNAUTHENTICATED");
  return identity;
}

/** A client never selects the owner; only the verified identity in the write transaction does. */
export async function handleDemandCreate(request: Request, db: Pick<PrismaClient, "$transaction"> = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    let json: unknown;
    try { json = await request.json(); } catch { return failure("INVALID_JSON"); }
    const input = DemandInput.safeParse(json);
    if (!input.success) return failure("VALIDATION_ERROR");
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new DemandCreateRejected("FORBIDDEN");
      const row = await tx.demandOrder.create({ data: { ...input.data, ownerId: current.userId, status: "published" } });
      if (row.ownerId !== current.userId || row.status !== "published") throw new DemandCreateRejected("DATABASE_UNAVAILABLE");
      return envelope(Demand).parse({ ok: true, data: toDemandDTO(row), meta: { source: "live" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { status: 201, headers });
  } catch (error) {
    if (error instanceof DemandCreateRejected) return failure(error.code);
    if (error instanceof OwnerAccessError) {
      return failure(error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN" ? error.code : "DATABASE_UNAVAILABLE");
    }
    return failure("DATABASE_UNAVAILABLE");
  }
}
