import type { Prisma, PrismaClient } from "@prisma/client";
import { Schedule, ScheduleCreateInput, ScheduleQuery, ScheduleRevisionInput, envelope, type ApiFailure } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";
import { toScheduleDTO } from "@/lib/schedule";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "修订字段、确认或工序依赖不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有排期修订权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  SCHEDULE_NOT_FOUND: { status: 404, message: "当前需求尚无初始排期。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "演示需求只读，不能修订排期。" },
  INVALID_STATE: { status: 409, message: "仅已发布或已签约的需求可修订未开工计划。" },
  SCHEDULE_VERSION_CONFLICT: { status: 409, message: "排期版本已变化，请刷新比较后重新确认。" },
  SCHEDULE_REVISION_NOT_ALLOWED: { status: 409, message: "仅全部待开始且未分配责任方的计划可修订。" },
  SCHEDULE_UNAVAILABLE: { status: 503, message: "暂时无法确认排期修订结果，请刷新后核实。" },
} as const;
class ScheduleRevisionRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new ScheduleRevisionRejected("UNAUTHENTICATED");
  return identity;
}
async function readInput(request: Request) {
  if (!request.body) throw new ScheduleRevisionRejected("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); throw new ScheduleRevisionRejected("VALIDATION_ERROR"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ScheduleRevisionRejected("INVALID_JSON"); }
  const input = ScheduleRevisionInput.safeParse(json);
  if (!input.success) throw new ScheduleRevisionRejected("VALIDATION_ERROR");
  return input.data;
}

/** Append an owner-confirmed plan; never reset ongoing work or overwrite history. */
export async function handleScheduleRevision(request: Request, db: Pick<PrismaClient, "$transaction"> = prisma) {
  if (request.method !== "PUT" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    const input = await readInput(request);
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new ScheduleRevisionRejected("FORBIDDEN");
      const demand = await tx.demandOrder.findFirst({
        where: { id: input.demandId, ownerId: current.userId }, select: { id: true, ownerId: true, status: true },
      });
      if (!demand) throw new ScheduleRevisionRejected("DEMAND_NOT_FOUND");
      if (demand.id !== input.demandId || demand.ownerId !== current.userId) throw new ScheduleRevisionRejected("SCHEDULE_UNAVAILABLE");
      if (demand.id === DEMO_DEMAND_ID) throw new ScheduleRevisionRejected("DEMO_DEMAND_READ_ONLY");
      if (!["published", "contracted"].includes(demand.status)) throw new ScheduleRevisionRejected("INVALID_STATE");
      const previous = await tx.schedule.findFirst({ where: { demandId: demand.id }, orderBy: { version: "desc" } });
      if (!previous) throw new ScheduleRevisionRejected("SCHEDULE_NOT_FOUND");
      const priorPlan = toScheduleDTO(previous);
      if (priorPlan.demandId !== demand.id) throw new ScheduleRevisionRejected("SCHEDULE_UNAVAILABLE");
      ScheduleQuery.parse({ demandId: priorPlan.demandId, version: priorPlan.version });
      ScheduleCreateInput.parse({ demandId: demand.id, tasks: priorPlan.tasks.map(({ id, name, startDay, durationDays, dependsOn }) =>
        ({ id, name, startDay, durationDays, dependsOn })) });
      if (priorPlan.version !== input.baseVersion) throw new ScheduleRevisionRejected("SCHEDULE_VERSION_CONFLICT");
      if (priorPlan.tasks.some(task => task.status !== "pending" || task.responsibleProviderId !== null)) {
        throw new ScheduleRevisionRejected("SCHEDULE_REVISION_NOT_ALLOWED");
      }
      const plan = Schedule.parse({ demandId: demand.id, version: input.baseVersion + 1,
        tasks: input.tasks.map(task => ({ ...task, status: "pending", responsibleProviderId: null })) });
      // Recheck the exact prior snapshot and absence of a newer version at the final write.
      await tx.demandOrder.update({
        where: { id: demand.id, ownerId: current.userId, status: demand.status, schedules: {
          some: { id: previous.id, version: input.baseVersion, tasksJson: previous.tasksJson },
          none: { version: { gt: input.baseVersion } },
        } },
        data: { schedules: { create: { version: plan.version, tasksJson: JSON.stringify(plan.tasks) } } },
        select: { id: true },
      });
      const row = await tx.schedule.findUniqueOrThrow({ where: { demandId_version: { demandId: demand.id, version: plan.version } } });
      const data = toScheduleDTO(row);
      if (JSON.stringify(data) !== JSON.stringify(plan)) throw new ScheduleRevisionRejected("SCHEDULE_UNAVAILABLE");
      return envelope(Schedule).parse({ ok: true, data, meta: { source: "live" } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { status: 201, headers });
  } catch (error) {
    if (error instanceof ScheduleRevisionRejected) return failure(error.code);
    if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
    return failure("SCHEDULE_UNAVAILABLE");
  }
}
