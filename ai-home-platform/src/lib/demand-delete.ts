import type { Prisma, PrismaClient } from "@prisma/client";
import { DemandDeleteResult, DemandIdParams, envelope, type ApiFailure } from "@/contracts";
import { DEMO_DEMAND_ID, EDITABLE_DEMAND_STATUSES, isEditableDemandStatus } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  VALIDATION_ERROR: { status: 400, message: "需求 ID 不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有需求删除权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  INVALID_STATE: { status: 409, message: "当前状态的需求不可删除。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能删除。" },
  DEMAND_HAS_RELATED_RECORDS: { status: 409, message: "需求已有报价、排期、付款、评价或工单记录，不能删除。" },
  DATABASE_UNAVAILABLE: { status: 503, message: "暂时无法确认需求删除结果，请刷新后核实。" },
} as const;

class DemandDeleteRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}

function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}

async function requireDeletable(tx: Prisma.TransactionClient, id: string, ownerId: string) {
  const row = await tx.demandOrder.findFirst({
    where: { id, ownerId },
    select: { id: true, ownerId: true, status: true,
      _count: { select: { quotes: true, schedules: true, payments: true, reviews: true, tickets: true } } },
  });
  if (!row) throw new DemandDeleteRejected("DEMAND_NOT_FOUND");
  if (row.id !== id || row.ownerId !== ownerId) throw new DemandDeleteRejected("DATABASE_UNAVAILABLE");
  if (row.id === DEMO_DEMAND_ID) throw new DemandDeleteRejected("DEMO_DEMAND_READ_ONLY");
  if (!isEditableDemandStatus(row.status)) throw new DemandDeleteRejected("INVALID_STATE");
  if (Object.values(row._count).some(count => count > 0)) throw new DemandDeleteRejected("DEMAND_HAS_RELATED_RECORDS");
}

/** DELETE 唯一入口：实际凭证、当前归属和全部删除约束在同一事务中核验。 */
export async function handleDemandDelete(
  request: Request,
  demandId: string,
  db: Pick<PrismaClient, "$transaction"> = prisma,
) {
  const params = DemandIdParams.safeParse({ id: demandId });
  if (!params.success) return failure("VALIDATION_ERROR");
  if (request.method !== "DELETE" || !isSameOrigin(request)) return failure("FORBIDDEN");

  try {
    const body = await db.$transaction(async tx => {
      const identity = await readOwnerVerifiedSession(request, tx);
      if (!identity) throw new DemandDeleteRejected("UNAUTHENTICATED");
      const id = params.data.id;
      await requireDeletable(tx, id, identity.userId);

      // 最终 SQL 再限制归属、状态与关联；不能只凭此前的检查按 id 删除。
      const deleted = await tx.demandOrder.deleteMany({ where: {
        id, ownerId: identity.userId, status: { in: [...EDITABLE_DEMAND_STATUSES] },
        quotes: { none: {} }, schedules: { none: {} }, payments: { none: {} },
        reviews: { none: {} }, tickets: { none: {} },
      } });
      if (deleted.count !== 1) {
        await requireDeletable(tx, id, identity.userId);
        throw new DemandDeleteRejected("DATABASE_UNAVAILABLE");
      }
      return envelope(DemandDeleteResult).parse({ ok: true, data: { id, deleted: true }, meta: { source: "live" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof DemandDeleteRejected || error instanceof OwnerAccessError) return failure(error.code);
    return failure("DATABASE_UNAVAILABLE");
  }
}
