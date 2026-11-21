import type { PrismaClient } from "@prisma/client";
import { Demand, DemandIdParams, envelope, type ApiFailure } from "@/contracts";
import { toDemandDTO } from "@/lib/demand";
import { demoDemand } from "@/lib/mock-data";
import { OWNER_SESSION_COOKIE, OwnerAccessError, readOwnerVerifiedSession } from "@/lib/owner-auth";
import { prisma } from "@/lib/prisma";

export const MATCHING_DEMAND_RESPONSE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
const failures = {
  VALIDATION_ERROR: { status: 400, message: "匹配查询参数不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "业主登录已失效，请重新登录或退出后浏览公开需求。" },
  FORBIDDEN: { status: 403, message: "当前身份没有需求匹配读取权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  DATABASE_UNAVAILABLE: { status: 503, message: "需求数据暂时无法读取，请稍后重试。" },
} as const;

export class MatchingDemandAccessError extends Error {
  readonly status: number;
  constructor(readonly code: keyof typeof failures) {
    super(failures[code].message);
    this.name = "MatchingDemandAccessError";
    this.status = failures[code].status;
  }
}

export function matchingDemandFailureResponse(error: MatchingDemandAccessError) {
  return Response.json({ ok: false, error: { code: error.code, message: error.message } } satisfies ApiFailure,
    { status: error.status, headers: MATCHING_DEMAND_RESPONSE_HEADERS });
}

function demandId(params: URLSearchParams): string | undefined {
  const keys = [...params.keys()];
  if (keys.length === 0) return undefined;
  if (keys.length !== 1 || keys[0] !== "demandId") throw new MatchingDemandAccessError("VALIDATION_ERROR");
  const parsed = DemandIdParams.safeParse({ id: params.get("demandId") });
  if (!parsed.success) throw new MatchingDemandAccessError("VALIDATION_ERROR");
  return parsed.data.id;
}

const DemandResponse = envelope(Demand);
function fixedDemo() {
  return DemandResponse.parse({ ok: true, data: demoDemand, meta: { source: "mock" } });
}

/** B must pass the original Request here before loading providers or ranking. */
export async function readMatchingDemand(request: Request, db: Pick<PrismaClient, "$transaction"> = prisma) {
  try {
    const id = demandId(new URL(request.url).searchParams);
    if (!["GET", "HEAD"].includes(request.method)) throw new MatchingDemandAccessError("FORBIDDEN");
    const hasOwnerCookie = (request.headers.get("cookie") ?? "").split(";")
      .some(value => value.trim().startsWith(`${OWNER_SESSION_COOKIE}=`));
    // Only an omitted ID selects fixed data; explicit demo IDs must exist and be accessible.
    if (id === undefined && !hasOwnerCookie) return fixedDemo();

    return await db.$transaction(async tx => {
      const identity = hasOwnerCookie ? await readOwnerVerifiedSession(request, tx) : null;
      if (hasOwnerCookie && !identity) throw new MatchingDemandAccessError("UNAUTHENTICATED");
      if (id === undefined) return fixedDemo();
      const row = await tx.demandOrder.findFirst({
        where: identity ? { id, OR: [{ status: "published" }, { ownerId: identity.userId }] } : { id, status: "published" },
        select: { id: true, ownerId: true, description: true, city: true, areaM2: true, budgetMinCents: true,
          budgetMaxCents: true, renovationType: true, desiredDays: true, status: true },
      });
      if (!row) throw new MatchingDemandAccessError("DEMAND_NOT_FOUND");
      if (row.id !== id || (row.status !== "published" && (!identity || row.ownerId !== identity.userId))) {
        throw new MatchingDemandAccessError("DATABASE_UNAVAILABLE");
      }
      const data = toDemandDTO(row);
      return DemandResponse.parse({ ok: true, data, meta: { source: data.source } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof MatchingDemandAccessError) throw error;
    if (error instanceof OwnerAccessError && error.code === "FORBIDDEN") throw new MatchingDemandAccessError("FORBIDDEN");
    throw new MatchingDemandAccessError("DATABASE_UNAVAILABLE");
  }
}
