import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { DemandIdParams, OwnerIdentity, OwnerSessionState, QuoteQuery, type ApiFailure, type OwnerIdentityDTO, type QuoteQueryDTO } from "@/contracts";
import { readDemoVerifiedSession } from "@/lib/demo-provider-session";

export const OWNER_SESSION_COOKIE = "__Host-ai_home_owner_session";
export const OWNER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const QUOTE_READ_RESPONSE_HEADERS = { "Cache-Control": "private, no-store", Vary: "Cookie" } as const;
type SessionDatabase = Pick<Prisma.TransactionClient, "ownerSession" | "user">;

const failures = {
  VALIDATION_ERROR: { status: 400, message: "报价查询参数不符合契约。" },
  UNAUTHENTICATED: { status: 401, message: "请先完成业主登录。" },
  FORBIDDEN: { status: 403, message: "当前身份没有业主报价读取权限。" },
  DEMAND_NOT_FOUND: { status: 404, message: "需求不存在或不可访问。" },
  DATABASE_UNAVAILABLE: { status: 503, message: "报价读取暂时不可用，请稍后重试。" },
} as const;

/** Public errors contain no database details and are safe for B to map to HTTP. */
export class OwnerAccessError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 503;
  constructor(readonly code: keyof typeof failures) {
    super(failures[code].message);
    this.name = "OwnerAccessError";
    this.status = failures[code].status;
  }
}

export function ownerAccessFailureResponse(error: OwnerAccessError) {
  return Response.json({ ok: false, error: { code: error.code, message: error.message } } satisfies ApiFailure,
    { status: error.status, headers: QUOTE_READ_RESPONSE_HEADERS });
}

/** null is exclusively the legacy no-query demo entry, never an invalid-query fallback. */
export function parseQuoteQuery(params: URLSearchParams): QuoteQueryDTO | null {
  const keys = [...params.keys()];
  if (keys.length === 0) return null;
  if (keys.length !== 1 || keys[0] !== "demandId") throw new OwnerAccessError("VALIDATION_ERROR");
  const parsed = QuoteQuery.safeParse({ demandId: params.get("demandId") });
  if (!parsed.success) throw new OwnerAccessError("VALIDATION_ERROR");
  return parsed.data;
}

function credential(request: Request) {
  const values = (request.headers.get("cookie") ?? "").split(";").map(value => value.trim())
    .filter(value => value.startsWith(`${OWNER_SESSION_COOKIE}=`));
  const token = values.length === 1 ? values[0].slice(OWNER_SESSION_COOKIE.length + 1) : "";
  return { present: values.length > 0, hash: /^[a-f0-9]{64}$/.test(token) ? hashToken(token) : null };
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function databaseError(error: unknown): never {
  throw error instanceof OwnerAccessError ? error : new OwnerAccessError("DATABASE_UNAVAILABLE");
}

/** Required tx avoids silently reading a global client outside B's transaction. */
export async function readOwnerVerifiedSession(
  request: Request, tx: SessionDatabase, now = new Date(),
): Promise<OwnerIdentityDTO | null> {
  const state = await readOwnerSessionState(request, tx, now);
  return state.status === "signed_in" ? state.identity : null;
}

/** Same credential/account checks as business authorization, without renewing expiry. */
export async function readOwnerSessionState(request: Request, tx: SessionDatabase, now = new Date()) {
  const { hash } = credential(request);
  if (!hash) return OwnerSessionState.parse({ status: "signed_out" });
  try {
    const session = await tx.ownerSession.findUnique({ where: { tokenHash: hash } });
    if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) return OwnerSessionState.parse({ status: "signed_out" });
    const account = await tx.user.findUnique({ where: { id: session.userId }, select: { id: true, role: true } });
    if (!account || account.role !== "owner") throw new OwnerAccessError("FORBIDDEN");
    return OwnerSessionState.parse({ status: "signed_in",
      identity: OwnerIdentity.parse({ userId: account.id, role: "owner", providerId: null }), expiresAt: session.expiresAt.toISOString() });
  } catch (error) { return databaseError(error); }
}

/** B passes this directly to readStoredQuoteComparison; no preflight identity is accepted. */
export async function authorizeOwnerQuoteRead(request: Request, demandId: string, tx: Prisma.TransactionClient): Promise<true> {
  if (!DemandIdParams.safeParse({ id: demandId }).success) throw new OwnerAccessError("VALIDATION_ERROR");
  if (!["GET", "HEAD"].includes(request.method)) throw new OwnerAccessError("FORBIDDEN");
  try {
    const session = await readOwnerVerifiedSession(request, tx);
    if (!session) {
      // Only classify an existing valid provider credential; never convert it to an owner.
      // An invalid/duplicate owner cookie cannot fall back to another identity.
      if (!credential(request).present && await readDemoVerifiedSession(request, tx)) throw new OwnerAccessError("FORBIDDEN");
      throw new OwnerAccessError("UNAUTHENTICATED");
    }
    const owned = await tx.demandOrder.findFirst({
      where: { id: demandId, ownerId: session.userId }, select: { id: true, ownerId: true },
    });
    if (!owned) throw new OwnerAccessError("DEMAND_NOT_FOUND");
    if (owned.id !== demandId || owned.ownerId !== session.userId) throw new OwnerAccessError("DATABASE_UNAVAILABLE");
    return true;
  } catch (error) { return databaseError(error); }
}

/**
 * D-only credential creation AFTER an upstream authenticator has verified this identity.
 * The public login handler must verify the password first; userId/role alone never prove identity.
 * Return the cookie only via Set-Cookie over HTTPS, never JSON, URLs, logs or client storage.
 */
export async function issueOwnerSession(verifiedIdentity: OwnerIdentityDTO, tx: SessionDatabase, now = new Date()) {
  const parsed = OwnerIdentity.safeParse(verifiedIdentity);
  if (!parsed.success) throw new OwnerAccessError("FORBIDDEN");
  try {
    const account = await tx.user.findUnique({ where: { id: parsed.data.userId }, select: { role: true } });
    if (account?.role !== "owner") throw new OwnerAccessError("FORBIDDEN");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(now.getTime() + OWNER_SESSION_TTL_SECONDS * 1000);
    await tx.ownerSession.create({ data: { tokenHash: hashToken(token), userId: parsed.data.userId, createdAt: now, expiresAt } });
    return { expiresAt, cookie: `${OWNER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${OWNER_SESSION_TTL_SECONDS}` };
  } catch (error) { return databaseError(error); }
}

/** D's future authenticated logout handler must enforce same-origin/CSRF checks before revocation. */
export async function revokeOwnerSession(request: Request, tx: SessionDatabase, now = new Date()) {
  const { hash } = credential(request);
  if (!hash) return;
  try {
    await tx.ownerSession.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: now } });
  } catch (error) { databaseError(error); }
}
