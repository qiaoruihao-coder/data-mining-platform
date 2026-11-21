import type { Prisma, PrismaClient } from "@prisma/client";
import { Demand, DemandIdParams, DemandUpdateInput, envelope, type ApiFailure } from "@/contracts";
import { DEMO_DEMAND_ID, EDITABLE_DEMAND_STATUSES, isEditableDemandStatus, toDemandDTO } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  VALIDATION_ERROR: { status: 400, message: "需求 ID 或字段不符合契约。" },
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有需求修改权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  INVALID_STATE: { status: 409, message: "当前状态的需求不可更新。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能更新。" },
  DATABASE_UNAVAILABLE: { status: 503, message: "暂时无法确认需求更新结果，请刷新后核实。" },
} as const;

class DemandUpdateRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}

function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}

async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new DemandUpdateRejected("UNAUTHENTICATED");
  return identity;
}

async function findOwnedDemand(tx: Prisma.TransactionClient, id: string, ownerId: string) {
  const row = await tx.demandOrder.findFirst({ where: { id, ownerId } });
  if (!row) throw new DemandUpdateRejected("DEMAND_NOT_FOUND");
  if (row.id !== id || row.ownerId !== ownerId) throw new DemandUpdateRejected("DATABASE_UNAVAILABLE");
  return row;
}

function requireEditable(row: { id: string; status: string }) {
  if (row.id === DEMO_DEMAND_ID) throw new DemandUpdateRejected("DEMO_DEMAND_READ_ONLY");
  if (!isEditableDemandStatus(row.status)) throw new DemandUpdateRejected("INVALID_STATE");
}

/** PUT 唯一入口：不接收身份快照或可替换会话 reader，写事务内重新验证实际凭证。 */
export async function handleDemandUpdate(
  request: Request,
  demandId: string,
  db: Pick<PrismaClient, "$transaction"> = prisma,
) {
  const params = DemandIdParams.safeParse({ id: demandId });
  if (!params.success) return failure("VALIDATION_ERROR");
  if (request.method !== "PUT" || !isSameOrigin(request)) return failure("FORBIDDEN");

  try {
    // 身份预检不读取需求；请求体读取在事务外，避免慢请求占用写事务。
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    let json: unknown;
    try { json = await request.json(); }
    catch { return failure("INVALID_JSON"); }
    const input = DemandUpdateInput.safeParse(json);
    if (!input.success) return failure("VALIDATION_ERROR");

    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new DemandUpdateRejected("FORBIDDEN");
      const id = params.data.id;
      const existing = await findOwnedDemand(tx, id, current.userId);
      requireEditable(existing);

      // 即使读取后归属/状态变化，最终 SQL 也不能只凭 id 更新。
      const updated = await tx.demandOrder.updateMany({
        where: { id, ownerId: current.userId, status: { in: [...EDITABLE_DEMAND_STATUSES] } },
        data: input.data,
      });
      if (updated.count !== 1) {
        requireEditable(await findOwnedDemand(tx, id, current.userId));
        throw new DemandUpdateRejected("DATABASE_UNAVAILABLE");
      }
      const row = await findOwnedDemand(tx, id, current.userId);
      requireEditable(row);
      // DTO/来源校验仍在写事务内，不能先提交再发现输出损坏。
      return envelope(Demand).parse({ ok: true, data: toDemandDTO(row), meta: { source: "live" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof DemandUpdateRejected || error instanceof OwnerAccessError) return failure(error.code);
    return failure("DATABASE_UNAVAILABLE");
  }
}
