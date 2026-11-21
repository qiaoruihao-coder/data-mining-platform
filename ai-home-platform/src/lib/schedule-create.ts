import type { Prisma, PrismaClient } from "@prisma/client";
import { Schedule, ScheduleCreateInput, envelope, type ApiFailure } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";
import { toScheduleDTO } from "@/lib/schedule";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "排期字段或工序依赖不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有排期创建权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能创建排期。" },
  INVALID_STATE: { status: 409, message: "仅已发布或已签约的需求可创建初始排期。" },
  SCHEDULE_ALREADY_EXISTS: { status: 409, message: "该需求已有排期，请刷新查看；不能覆盖或重复创建。" },
  SCHEDULE_UNAVAILABLE: { status: 503, message: "暂时无法确认排期创建结果，请刷新后核实。" },
} as const;
class ScheduleCreateRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new ScheduleCreateRejected("UNAUTHENTICATED");
  return identity;
}
async function readInput(request: Request) {
  if (!request.body) throw new ScheduleCreateRejected("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new ScheduleCreateRejected("VALIDATION_ERROR"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ScheduleCreateRejected("INVALID_JSON"); }
  const input = ScheduleCreateInput.safeParse(json);
  if (!input.success) throw new ScheduleCreateRejected("VALIDATION_ERROR");
  return input.data;
}

/** Only the owner can create an initial plan; no status, provider or version is client-controlled. */
export async function handleScheduleCreate(request: Request, db: Pick<PrismaClient, "$transaction"> = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size > 0) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    const input = await readInput(request);
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new ScheduleCreateRejected("FORBIDDEN");
      const demand = await tx.demandOrder.findFirst({
        where: { id: input.demandId, ownerId: current.userId }, select: { id: true, ownerId: true, status: true },
      });
      if (!demand) throw new ScheduleCreateRejected("DEMAND_NOT_FOUND");
      if (demand.id !== input.demandId || demand.ownerId !== current.userId) throw new ScheduleCreateRejected("SCHEDULE_UNAVAILABLE");
      if (demand.id === DEMO_DEMAND_ID) throw new ScheduleCreateRejected("DEMO_DEMAND_READ_ONLY");
      if (!["published", "contracted"].includes(demand.status)) throw new ScheduleCreateRejected("INVALID_STATE");
      if (await tx.schedule.findFirst({ where: { demandId: demand.id }, select: { id: true } })) {
        throw new ScheduleCreateRejected("SCHEDULE_ALREADY_EXISTS");
      }
      const plan = Schedule.parse({ demandId: demand.id, version: 1,
        tasks: input.tasks.map(task => ({ ...task, status: "pending", responsibleProviderId: null })) });
      // The nested write still restricts current ownership/state and absence of any version.
      await tx.demandOrder.update({
        where: { id: demand.id, ownerId: current.userId, status: demand.status, schedules: { none: {} } },
        data: { schedules: { create: { version: 1, tasksJson: JSON.stringify(plan.tasks) } } },
        select: { id: true },
      });
      const row = await tx.schedule.findUniqueOrThrow({ where: { demandId_version: { demandId: demand.id, version: 1 } } });
      const data = toScheduleDTO(row);
      if (JSON.stringify(data) !== JSON.stringify(plan)) throw new ScheduleCreateRejected("SCHEDULE_UNAVAILABLE");
      // Output validation happens before commit so a malformed persisted result rolls back.
      return envelope(Schedule).parse({ ok: true, data, meta: { source: "live" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { status: 201, headers });
  } catch (error) {
    if (error instanceof ScheduleCreateRejected) return failure(error.code);
    if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
    return failure("SCHEDULE_UNAVAILABLE");
  }
}
