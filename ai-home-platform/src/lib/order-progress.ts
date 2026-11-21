import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, Schedule as StoredSchedule } from "@prisma/client";
import { OrderProgressInput, OrderProgressResult, Schedule, ScheduleCreateInput, ScheduleQuery, SQLITE_INT_MAX,
  envelope, type ApiFailure, type OrderSummaryDTO } from "@/contracts";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { isSameOrigin } from "@/lib/demo-provider-session";
import { orderInclude, orderSummaryFromRecord } from "@/lib/order";
import { OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";
import { toScheduleDTO } from "@/lib/schedule";

type Database = Pick<PrismaClient, "$transaction">;
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  INVALID_JSON: { status: 400, message: "请求不是有效 JSON。" },
  VALIDATION_ERROR: { status: 400, message: "履约动作、确认或排期版本不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前请求没有业主履约确认权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  ORDER_NOT_FOUND: { status: 404, message: "该需求没有可访问的目标接单。" },
  TASK_NOT_FOUND: { status: 404, message: "当前排期没有目标工序。" },
  DEMO_DEMAND_READ_ONLY: { status: 409, message: "固定演示需求只读，不能推进履约。" },
  ORDER_PROGRESS_NOT_ALLOWED: { status: 409, message: "当前状态不允许此动作，不能跳级或回退，请刷新核实。" },
  SCHEDULE_VERSION_CONFLICT: { status: 409, message: "排期版本已变化，请刷新核实并重新确认。" },
  SCHEDULE_PROGRESS_NOT_ALLOWED: { status: 409, message: "当前计划状态或责任方不支持此推进，请核实。" },
  SCHEDULE_NOT_COMPLETE: { status: 409, message: "请先逐项确认最新排期的工序完成，再确认整单完成。" },
  TASK_PROGRESS_NOT_ALLOWED: { status: 409, message: "工序状态或前置依赖不满足此动作，请刷新核实。" },
  ORDER_PROGRESS_UNAVAILABLE: { status: 503, message: "暂时无法确认履约结果，请先刷新需求和排期核实，勿自动重发。" },
} as const;
class ProgressRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}
function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}
async function requireOwner(request: Request, tx: Prisma.TransactionClient) {
  const identity = await readOwnerVerifiedSession(request, tx);
  if (!identity) throw new ProgressRejected("UNAUTHENTICATED");
  return identity;
}
async function readInput(request: Request) {
  if (!request.body) throw new ProgressRejected("INVALID_JSON");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new ProgressRejected("VALIDATION_ERROR"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let json: unknown;
  try { json = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ProgressRejected("INVALID_JSON"); }
  const parsed = OrderProgressInput.safeParse(json);
  if (!parsed.success) throw new ProgressRejected("VALIDATION_ERROR");
  return parsed.data;
}
function checkedPlan(row: StoredSchedule | null, order: OrderSummaryDTO) {
  if (!row) return null;
  const data = toScheduleDTO(row);
  if (data.demandId !== order.demandId) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
  ScheduleQuery.parse({ demandId: data.demandId, version: data.version });
  ScheduleCreateInput.parse({ demandId: data.demandId, tasks: data.tasks.map(({ id, name, startDay, durationDays, dependsOn }) =>
    ({ id, name, startDay, durationDays, dependsOn })) });
  const byId = new Map(data.tasks.map(task => [task.id, task]));
  if (data.tasks.some(task => ["active", "done"].includes(task.status)
    && task.dependsOn.some(id => byId.get(id)?.status !== "done"))) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
  if (order.status === "completed" && data.tasks.some(task => task.status !== "done")) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
  return data;
}

/** Owner-confirmed fulfillment; both statuses, any new plan version and the audit event commit together. */
export async function handleOrderProgress(request: Request, db: Database = prisma) {
  if (request.method !== "POST" || !isSameOrigin(request)) return failure("FORBIDDEN");
  if (new URL(request.url).searchParams.size) return failure("VALIDATION_ERROR");
  try {
    const expected = await db.$transaction(tx => requireOwner(request, tx), { isolationLevel: "Serializable" });
    const input = await readInput(request);
    const body = await db.$transaction(async tx => {
      const current = await requireOwner(request, tx);
      if (current.userId !== expected.userId) throw new ProgressRejected("FORBIDDEN");
      const demand = await tx.demandOrder.findFirst({ where: { id: input.demandId, ownerId: current.userId }, select: { id: true, ownerId: true, status: true } });
      if (!demand) throw new ProgressRejected("DEMAND_NOT_FOUND");
      if (demand.id !== input.demandId || demand.ownerId !== current.userId) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
      if (demand.id === DEMO_DEMAND_ID) throw new ProgressRejected("DEMO_DEMAND_READ_ONLY");
      const row = await tx.serviceOrder.findFirst({ where: { id: input.orderId, demandId: demand.id, demand: { ownerId: current.userId } }, include: orderInclude });
      if (!row) throw new ProgressRejected("ORDER_NOT_FOUND");
      const order = orderSummaryFromRecord(row);
      if (order.id !== input.orderId || order.demandId !== demand.id || order.status !== demand.status) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
      const previous = await tx.schedule.findFirst({ where: { demandId: demand.id }, orderBy: { version: "desc" } });
      const plan = checkedPlan(previous, order);
      if ((plan?.version ?? null) !== input.scheduleVersion) throw new ProgressRejected("SCHEDULE_VERSION_CONFLICT");
      if (plan?.tasks.some(task => task.responsibleProviderId !== null && task.responsibleProviderId !== order.providerId)) {
        throw new ProgressRejected("SCHEDULE_PROGRESS_NOT_ALLOWED");
      }
      let targetStatus = order.status;
      let targetPlan = plan;
      let changed = false;
      if (input.action === "start") {
        if (order.status === "completed") throw new ProgressRejected("ORDER_PROGRESS_NOT_ALLOWED");
        if (order.status === "contracted") {
          if (plan?.tasks.some(task => task.status !== "pending")) throw new ProgressRejected("SCHEDULE_PROGRESS_NOT_ALLOWED");
          targetStatus = "in_progress"; changed = true;
        }
      } else if (input.action === "complete") {
        if (order.status === "contracted") throw new ProgressRejected("ORDER_PROGRESS_NOT_ALLOWED");
        if (plan?.tasks.some(task => task.status !== "done")) throw new ProgressRejected("SCHEDULE_NOT_COMPLETE");
        if (order.status === "in_progress") { targetStatus = "completed"; changed = true; }
      } else {
        if (order.status !== "in_progress") throw new ProgressRejected("ORDER_PROGRESS_NOT_ALLOWED");
        if (!plan) throw new ProgressRejected("SCHEDULE_PROGRESS_NOT_ALLOWED");
        const task = plan.tasks.find(item => item.id === input.taskId);
        if (!task) throw new ProgressRejected("TASK_NOT_FOUND");
        const from = input.action === "start_task" ? "pending" : "active";
        const to = input.action === "start_task" ? "active" : "done";
        if ((task.status !== from && task.status !== to) || task.dependsOn.some(id => plan.tasks.find(item => item.id === id)?.status !== "done")) {
          throw new ProgressRejected("TASK_PROGRESS_NOT_ALLOWED");
        }
        if (task.status === from) {
          if (plan.version === SQLITE_INT_MAX) throw new ProgressRejected("SCHEDULE_PROGRESS_NOT_ALLOWED");
          targetPlan = Schedule.parse({ ...plan, version: plan.version + 1,
            tasks: plan.tasks.map(item => item.id === task.id ? { ...item, status: to } : item) });
          changed = true;
        }
      }
      const planned = OrderProgressResult.parse({ order: { ...order, status: targetStatus }, schedule: targetPlan });
      if (!changed) return envelope(OrderProgressResult).parse({ ok: true, data: planned, meta: { source: order.source } });
      const quote = row.acceptedQuote;
      const sameQuote = { id: quote.id, demandId: demand.id, providerId: order.providerId, status: "accepted", source: order.source,
        itemsJson: quote.itemsJson, pendingItemsJson: quote.pendingItemsJson, knownTotalCents: quote.knownTotalCents, estimatedDays: quote.estimatedDays };
      const guard: Prisma.DemandOrderWhereInput = { id: demand.id, ownerId: current.userId, status: order.status,
        serviceOrder: { is: { ...order, acceptedQuote: { is: sameQuote } } },
        schedules: previous ? { some: { id: previous.id, version: previous.version, tasksJson: previous.tasksJson }, none: { version: { gt: previous.version } } } : { none: {} },
      };
      if ((await tx.demandOrder.updateMany({ where: guard, data: { status: targetStatus } })).count !== 1) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
      if ((await tx.serviceOrder.updateMany({ where: { ...order, demand: { ownerId: current.userId, status: targetStatus }, acceptedQuote: { is: sameQuote } },
        data: { status: targetStatus } })).count !== 1) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
      if (targetPlan && targetPlan !== plan) {
        await tx.schedule.create({ data: { demandId: demand.id, version: targetPlan.version, tasksJson: JSON.stringify(targetPlan.tasks) } });
      }
      await tx.orderProgressEvent.create({ data: { id: randomUUID(), orderId: order.id, actorId: current.userId,
        action: input.action, fromStatus: order.status, toStatus: targetStatus,
        taskId: "taskId" in input ? input.taskId : null, scheduleVersion: targetPlan?.version ?? null } });
      const persisted = await tx.serviceOrder.findFirstOrThrow({ where: { id: order.id, demand: { ownerId: current.userId } }, include: orderInclude });
      const savedOrder = orderSummaryFromRecord(persisted);
      const savedSchedule = checkedPlan(await tx.schedule.findFirst({ where: { demandId: demand.id }, orderBy: { version: "desc" } }), savedOrder);
      const data = OrderProgressResult.parse({ order: savedOrder, schedule: savedSchedule });
      if (JSON.stringify(data) !== JSON.stringify(planned)) throw new ProgressRejected("ORDER_PROGRESS_UNAVAILABLE");
      return envelope(OrderProgressResult).parse({ ok: true, data, meta: { source: order.source } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof ProgressRejected) return failure(error.code);
    if (error instanceof OwnerAccessError && (error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN")) return failure(error.code);
    return failure("ORDER_PROGRESS_UNAVAILABLE");
  }
}
