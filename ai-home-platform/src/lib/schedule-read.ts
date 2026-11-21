import type { PrismaClient } from "@prisma/client";
import { Schedule, ScheduleQuery, envelope, type ApiFailure, type ScheduleQueryDTO } from "@/contracts";
import { readDemoVerifiedSession } from "@/lib/demo-provider-session";
import { DEMO_DEMAND_ID } from "@/lib/demand";
import { schedule } from "@/lib/mock-data";
import { OWNER_SESSION_COOKIE, OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";
import { findSchedule } from "@/lib/schedule";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  VALIDATION_ERROR: { status: 400, message: "排期查询参数不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前身份没有业主排期读取权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  SCHEDULE_NOT_FOUND: { status: 404, message: "当前需求没有对应排期版本。" },
  SCHEDULE_UNAVAILABLE: { status: 503, message: "排期数据暂时无法读取。" },
} as const;

class ScheduleReadRejected extends Error {
  constructor(readonly code: keyof typeof failures) { super(failures[code].message); }
}

function failure(code: keyof typeof failures) {
  const { status, message } = failures[code];
  return Response.json({ ok: false, error: { code, message } } satisfies ApiFailure, { status, headers });
}

/** Unknown parameters never select the demo entry. IDs retain their exact value. */
function parseQuery(params: URLSearchParams): ScheduleQueryDTO | null {
  const keys = [...params.keys()];
  if (keys.length === 0) return null;
  const demandIds = params.getAll("demandId");
  const versions = params.getAll("version");
  if (keys.some(key => key !== "demandId" && key !== "version") || demandIds.length !== 1 || versions.length > 1) {
    throw new ScheduleReadRejected("VALIDATION_ERROR");
  }
  const version = versions[0];
  if (version !== undefined && !/^\d+$/.test(version)) throw new ScheduleReadRejected("VALIDATION_ERROR");
  const parsed = ScheduleQuery.safeParse({ demandId: demandIds[0], version: version === undefined ? undefined : Number(version) });
  if (!parsed.success) throw new ScheduleReadRejected("VALIDATION_ERROR");
  return parsed.data;
}

function demoSchedule(version?: number) {
  if (version !== undefined && version !== schedule.version) throw new ScheduleReadRejected("SCHEDULE_NOT_FOUND");
  return envelope(Schedule).parse({ ok: true, data: schedule, meta: { source: "mock" } });
}

export async function handleScheduleRead(request: Request, db: Pick<PrismaClient, "$transaction"> = prisma) {
  try {
    const query = parseQuery(new URL(request.url).searchParams);
    if (!["GET", "HEAD"].includes(request.method)) return failure("FORBIDDEN");
    const hasOwnerCookie = (request.headers.get("cookie") ?? "").split(";")
      .some(value => value.trim().startsWith(`${OWNER_SESSION_COOKIE}=`));
    // Only the fixed seed ID is public; status and source cannot grant access.
    if ((query === null || query.demandId === DEMO_DEMAND_ID) && !hasOwnerCookie) {
      return Response.json(demoSchedule(query?.version), { headers });
    }

    // Credentials, current ownership and schedule data must share the same snapshot.
    const body = await db.$transaction(async tx => {
      const identity = await readOwnerVerifiedSession(request, tx);
      if (!identity) {
        if (!hasOwnerCookie && await readDemoVerifiedSession(request, tx)) throw new ScheduleReadRejected("FORBIDDEN");
        throw new ScheduleReadRejected("UNAUTHENTICATED");
      }
      // A supplied owner credential must be valid even for fixed demo data.
      if (query === null || query.demandId === DEMO_DEMAND_ID) return demoSchedule(query?.version);
      const demand = await tx.demandOrder.findFirst({
        where: { id: query.demandId, ownerId: identity.userId }, select: { id: true, ownerId: true },
      });
      if (!demand) throw new ScheduleReadRejected("DEMAND_NOT_FOUND");
      if (demand.id !== query.demandId || demand.ownerId !== identity.userId) throw new ScheduleReadRejected("SCHEDULE_UNAVAILABLE");
      const result = await findSchedule(query, tx);
      if (!result) throw new ScheduleReadRejected("SCHEDULE_NOT_FOUND");
      if (result.data.demandId !== query.demandId || (query.version !== undefined && result.data.version !== query.version)) {
        throw new ScheduleReadRejected("SCHEDULE_UNAVAILABLE");
      }
      return envelope(Schedule).parse({ ok: true, data: result.data, meta: { source: result.source } });
    }, { isolationLevel: "Serializable" });
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof ScheduleReadRejected) return failure(error.code);
    if (error instanceof OwnerAccessError && error.code === "FORBIDDEN") return failure("FORBIDDEN");
    return failure("SCHEDULE_UNAVAILABLE");
  }
}
